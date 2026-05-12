import type { ChangeEvent, RefObject } from "react";
import { DeleteEpisodeConfirmDialog, ReorderConflictDialog } from "./EpisodeConflictDialogs";
import { ScriptBreakdownLightbox } from "./ScriptBreakdownLightbox";

type ScriptBreakdownOverlaysProps = {
  uploadInputRef: RefObject<HTMLInputElement | null>;
  onFileSelected: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  deleteEpisodeCandidate: number | null;
  onCancelDeleteEpisode: () => void;
  onConfirmDeleteEpisode: (episodeNo: number) => void;
  reorderConflictEpisodes: number[];
  onCloseReorderConflict: () => void;
  lightbox: { url: string; label: string } | null;
  onCloseLightbox: () => void;
};

export function ScriptBreakdownOverlays({
  uploadInputRef,
  onFileSelected,
  deleteEpisodeCandidate,
  onCancelDeleteEpisode,
  onConfirmDeleteEpisode,
  reorderConflictEpisodes,
  onCloseReorderConflict,
  lightbox,
  onCloseLightbox,
}: ScriptBreakdownOverlaysProps) {
  return (
    <>
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void onFileSelected(event)}
      />

      {deleteEpisodeCandidate != null && (
        <DeleteEpisodeConfirmDialog
          episodeNo={deleteEpisodeCandidate}
          onCancel={onCancelDeleteEpisode}
          onConfirm={() => onConfirmDeleteEpisode(deleteEpisodeCandidate)}
        />
      )}

      {reorderConflictEpisodes.length > 0 && (
        <ReorderConflictDialog
          episodeNumbers={reorderConflictEpisodes}
          onClose={onCloseReorderConflict}
        />
      )}

      {lightbox && (
        <ScriptBreakdownLightbox
          label={lightbox.label}
          url={lightbox.url}
          onClose={onCloseLightbox}
        />
      )}
    </>
  );
}
