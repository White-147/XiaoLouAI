import type { Storyboard } from "../../../lib/api";
import type { StoryboardShotActionState, StoryboardShotCardActions } from "./storyboard-shot-types";
import { StoryboardShotActionColumn } from "./StoryboardShotActionColumn";
import { StoryboardShotMediaPreview } from "./StoryboardShotMediaPreview";
import { StoryboardShotPartHeader } from "./StoryboardShotPartHeader";
import { StoryboardShotPromptEditor } from "./StoryboardShotPromptEditor";
import { StoryboardShotReferenceControls } from "./StoryboardShotReferenceControls";

type StoryboardShotCardProps = {
  item: Storyboard;
  previousItem?: Storyboard;
  currentProjectId: string | null;
  shotState: StoryboardShotActionState;
  shotActions: StoryboardShotCardActions;
};

export function StoryboardShotCard({
  item,
  previousItem,
  currentProjectId,
  shotState,
  shotActions,
}: StoryboardShotCardProps) {
  const {
    onUpdateDraftPrompt,
    onBlurSave,
    onToggleRefPicker,
    onCloseRefPicker,
    onToggleRefImage,
    onLocalUpload,
    onToggleModelPicker,
    onSelectShotModel,
    onGenerateImage,
    onDeleteShot,
    onOpenLightbox,
  } = shotActions;
  const {
    draftPrompt,
    selectedRefs,
    shotModelId,
    isImgPending,
    isDelPending,
    isPickerOpen,
    isModelOpen,
    uploading,
    uploadingForShot,
  } = shotState;
  const lightboxLabel = `S${String(item.shotNo).padStart(2, "0")}`;

  return (
    <div>
      <StoryboardShotPartHeader item={item} previousItem={previousItem} />

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4 transition-shadow hover:shadow-lg hover:shadow-black/10">
        <div className="flex gap-4">
          <StoryboardShotMediaPreview
            item={item}
            lightboxLabel={lightboxLabel}
            onOpenLightbox={onOpenLightbox}
          />

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <StoryboardShotPromptEditor
              item={item}
              draftPrompt={draftPrompt}
              onUpdateDraftPrompt={onUpdateDraftPrompt}
              onBlurSave={onBlurSave}
            />

            <StoryboardShotReferenceControls
              currentProjectId={currentProjectId}
              shotId={item.id}
              selectedRefs={selectedRefs}
              shotModelId={shotModelId}
              isPickerOpen={isPickerOpen}
              isModelOpen={isModelOpen}
              uploading={uploading}
              uploadingForShot={uploadingForShot}
              onToggleRefPicker={onToggleRefPicker}
              onCloseRefPicker={onCloseRefPicker}
              onToggleRefImage={onToggleRefImage}
              onLocalUpload={onLocalUpload}
              onToggleModelPicker={onToggleModelPicker}
              onSelectShotModel={onSelectShotModel}
            />
          </div>

          <StoryboardShotActionColumn
            item={item}
            isImgPending={isImgPending}
            isDelPending={isDelPending}
            onGenerateImage={onGenerateImage}
            onDeleteShot={onDeleteShot}
          />
        </div>
      </div>
    </div>
  );
}
