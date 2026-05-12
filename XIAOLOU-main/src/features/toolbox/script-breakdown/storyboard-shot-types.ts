import type { ReferenceAssetSelection } from "../../assets-media-projects/reference-assets/ReferenceAssetPicker";
import type { Storyboard } from "../../../lib/api";

export type StoryboardShotActionState = {
  draftPrompt: string;
  selectedRefs: ReferenceAssetSelection[];
  shotModelId: string;
  isImgPending: boolean;
  isDelPending: boolean;
  isPickerOpen: boolean;
  isModelOpen: boolean;
  uploading: boolean;
  uploadingForShot: string | null;
};

export type StoryboardShotCardActions = {
  onUpdateDraftPrompt: (shotId: string, value: string) => void;
  onBlurSave: (item: Storyboard) => void | Promise<void>;
  onToggleRefPicker: (shotId: string) => void;
  onCloseRefPicker: () => void;
  onToggleRefImage: (shotId: string, asset: ReferenceAssetSelection, selected: boolean) => void;
  onLocalUpload: (shotId: string) => void;
  onToggleModelPicker: (shotId: string) => void;
  onSelectShotModel: (shotId: string, modelId: string) => void;
  onGenerateImage: (item: Storyboard) => void | Promise<void>;
  onDeleteShot: (item: Storyboard) => void | Promise<void>;
  onOpenLightbox: (url: string, label: string) => void;
};
