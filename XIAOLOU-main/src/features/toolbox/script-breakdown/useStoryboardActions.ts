import {
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReferenceAssetSelection } from "../../assets-media-projects/reference-assets/ReferenceAssetPicker";
import {
  deleteStoryboard,
  generateStoryboardImage,
  getStoryboard,
  updateStoryboard,
  uploadFile,
  type Storyboard,
  type Task,
} from "../../../lib/api";
import { DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID } from "../../canvas-agent-canvas/canvas/runtime/config/canvasImageModels";
import type { StoryboardShotActionState, StoryboardShotCardActions } from "./storyboard-shot-types";

type EpisodeStoryboards = Record<number, Storyboard[]>;
type EpisodeDraftPrompts = Record<number, Record<string, string>>;

type UseStoryboardActionsArgs = {
  currentProjectId: string | null;
  activeEpisode: number;
  draftPrompts: Record<string, string>;
  pendingTask: string | null;
  patchActiveShot: (storyboard: Storyboard) => void;
  setEpisodeStoryboards: Dispatch<SetStateAction<EpisodeStoryboards>>;
  setEpisodeDraftPrompts: Dispatch<SetStateAction<EpisodeDraftPrompts>>;
  setPendingTask: Dispatch<SetStateAction<string | null>>;
  setNotice: (notice: string | null) => void;
  waitForTask: (taskId: string) => Promise<Task | null>;
  onOpenLightbox: StoryboardShotCardActions["onOpenLightbox"];
};

export function useStoryboardActions({
  currentProjectId,
  activeEpisode,
  draftPrompts,
  pendingTask,
  patchActiveShot,
  setEpisodeStoryboards,
  setEpisodeDraftPrompts,
  setPendingTask,
  setNotice,
  waitForTask,
  onOpenLightbox,
}: UseStoryboardActionsArgs) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [refImages, setRefImages] = useState<Record<string, ReferenceAssetSelection[]>>({});
  const [showRefPicker, setShowRefPicker] = useState<string | null>(null);
  const [shotModels, setShotModels] = useState<Record<string, string>>({});
  const [showModelPicker, setShowModelPicker] = useState<string | null>(null);
  const [uploadingForShot, setUploadingForShot] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const resetStoryboardActionState = () => {
    setRefImages({});
    setShowRefPicker(null);
    setShotModels({});
    setShowModelPicker(null);
    setUploadingForShot(null);
    setUploading(false);
  };

  const getShotModel = (shotId: string) =>
    shotModels[shotId] ?? DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID;

  const imagePendingTaskKey = (shotId: string) => `img-${shotId}`;
  const deletePendingTaskKey = (shotId: string) => `del-${shotId}`;

  const getShotActionState = (item: Storyboard): StoryboardShotActionState => ({
    draftPrompt: draftPrompts[item.id] ?? item.script,
    selectedRefs: refImages[item.id] ?? [],
    shotModelId: getShotModel(item.id),
    isImgPending: pendingTask === imagePendingTaskKey(item.id),
    isDelPending: pendingTask === deletePendingTaskKey(item.id),
    isPickerOpen: showRefPicker === item.id,
    isModelOpen: showModelPicker === item.id,
    uploading,
    uploadingForShot,
  });

  const toggleRefPickerForShot = (shotId: string) => {
    setShowRefPicker((openShotId) => (openShotId === shotId ? null : shotId));
  };

  const closeRefPicker = () => {
    setShowRefPicker(null);
  };

  const toggleModelPickerForShot = (shotId: string) => {
    setShowModelPicker((openShotId) => (openShotId === shotId ? null : shotId));
  };

  const closeModelPicker = () => {
    setShowModelPicker(null);
  };

  useEffect(() => {
    document.addEventListener("click", closeModelPicker);
    return () => document.removeEventListener("click", closeModelPicker);
  }, []);

  const selectShotModel = (shotId: string, modelId: string) => {
    setShotModels((prev) => ({
      ...prev,
      [shotId]: modelId,
    }));
    closeModelPicker();
  };

  const updateDraftPrompt = (shotId: string, value: string) => {
    setEpisodeDraftPrompts((prev) => ({
      ...prev,
      [activeEpisode]: {
        ...(prev[activeEpisode] ?? {}),
        [shotId]: value,
      },
    }));
  };

  const handleGenerateImage = async (item: Storyboard) => {
    if (!currentProjectId) return;
    const pendingKey = imagePendingTaskKey(item.id);
    setPendingTask(pendingKey);
    setNotice(null);
    try {
      const prompt = draftPrompts[item.id] ?? item.script;
      const urls = (refImages[item.id] ?? []).map((asset) => asset.url);
      const accepted = await generateStoryboardImage(item.id, prompt, urls, getShotModel(item.id));
      const finished = await waitForTask(accepted.taskId);
      if (finished?.status === "succeeded") {
        const updated = await getStoryboard(currentProjectId, item.id);
        patchActiveShot(updated);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "生成参考图失败");
    } finally {
      setPendingTask((pending) => (pending === pendingKey ? null : pending));
    }
  };

  const handleBlurSave = async (item: Storyboard) => {
    if (!currentProjectId) return;
    const nextScript = draftPrompts[item.id];
    if (!nextScript || nextScript === item.script) return;
    try {
      await updateStoryboard(currentProjectId, item.id, { script: nextScript });
      setEpisodeStoryboards((prev) => ({
        ...prev,
        [activeEpisode]: (prev[activeEpisode] ?? []).map((storyboard) =>
          storyboard.id === item.id ? { ...storyboard, script: nextScript } : storyboard,
        ),
      }));
    } catch {
      // Keep the draft so the user can retry by blurring again.
    }
  };

  const handleDeleteShot = async (item: Storyboard) => {
    if (!currentProjectId) return;
    const pendingKey = deletePendingTaskKey(item.id);
    setPendingTask(pendingKey);
    try {
      await deleteStoryboard(currentProjectId, item.id);
      setEpisodeStoryboards((prev) => ({
        ...prev,
        [activeEpisode]: (prev[activeEpisode] ?? []).filter((storyboard) => storyboard.id !== item.id),
      }));
    } finally {
      setPendingTask((pending) => (pending === pendingKey ? null : pending));
    }
  };

  const toggleRefImage = (
    shotId: string,
    asset: ReferenceAssetSelection,
    selected: boolean,
  ) => {
    setRefImages((prev) => {
      const current = prev[shotId] ?? [];
      return {
        ...prev,
        [shotId]: selected
          ? [...current.filter((item) => item.id !== asset.id), asset]
          : current.filter((item) => item.id !== asset.id),
      };
    });
  };

  const handleLocalUploadClick = (shotId: string) => {
    setUploadingForShot(shotId);
    uploadInputRef.current?.click();
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !uploadingForShot) {
      setUploadingForShot(null);
      return;
    }

    const targetShot = uploadingForShot;
    setUploading(true);
    try {
      const uploaded = await uploadFile(file, "image");
      const asset: ReferenceAssetSelection = {
        id: uploaded.id,
        name: uploaded.originalName,
        url: uploaded.url,
        previewUrl: uploaded.url,
        assetType: "upload",
        description: "",
        mediaKind: "image",
      };
      toggleRefImage(targetShot, asset, true);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "上传失败，请重试");
    } finally {
      setUploading(false);
      setUploadingForShot(null);
    }
  };

  const shotActions = {
    onUpdateDraftPrompt: updateDraftPrompt,
    onBlurSave: handleBlurSave,
    onToggleRefPicker: toggleRefPickerForShot,
    onCloseRefPicker: closeRefPicker,
    onToggleRefImage: toggleRefImage,
    onLocalUpload: handleLocalUploadClick,
    onToggleModelPicker: toggleModelPickerForShot,
    onSelectShotModel: selectShotModel,
    onGenerateImage: handleGenerateImage,
    onDeleteShot: handleDeleteShot,
    onOpenLightbox,
  } satisfies StoryboardShotCardActions;

  return {
    uploadInputRef,
    resetStoryboardActionState,
    getShotActionState,
    shotActions,
    handleFileSelected,
  };
}
