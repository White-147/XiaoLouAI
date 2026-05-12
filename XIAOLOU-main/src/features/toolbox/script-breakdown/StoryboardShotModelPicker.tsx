import {
  CheckCircle2,
  ChevronDown,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { XIAOLOU_TEXT_TO_IMAGE_MODELS } from "../../canvas-agent-canvas/canvas/runtime/config/canvasImageModels";

type StoryboardShotModelPickerProps = {
  shotId: string;
  shotModelId: string;
  isModelOpen: boolean;
  onToggleModelPicker: (shotId: string) => void;
  onSelectShotModel: (shotId: string, modelId: string) => void;
};

export function StoryboardShotModelPicker({
  shotId,
  shotModelId,
  isModelOpen,
  onToggleModelPicker,
  onSelectShotModel,
}: StoryboardShotModelPickerProps) {
  const currentModel =
    XIAOLOU_TEXT_TO_IMAGE_MODELS.find((model) => model.id === shotModelId) ??
    XIAOLOU_TEXT_TO_IMAGE_MODELS[0];

  return (
    <div className="relative ml-auto" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => onToggleModelPicker(shotId)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
          isModelOpen
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-primary/5",
        )}
      >
        <ImageIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
        {currentModel?.name ?? "选择模型"}
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            isModelOpen && "rotate-180",
          )}
        />
      </button>

      {isModelOpen && (
        <div className="absolute right-0 top-full z-20 mt-1.5 w-52 rounded-xl border border-border bg-card shadow-2xl shadow-black/20">
          <div className="border-b border-border px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              选择生成模型
            </p>
          </div>
          <div className="p-1.5">
            {XIAOLOU_TEXT_TO_IMAGE_MODELS.map((model) => {
              const isSelected = shotModelId === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => onSelectShotModel(shotId, model.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors",
                    isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent",
                  )}
                >
                  <span className="font-medium">{model.name}</span>
                  {model.recommended && !isSelected && (
                    <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-300">
                      推荐
                    </span>
                  )}
                  {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
