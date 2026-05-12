import type { UploadedFile } from "./media-types";

export type MediaServiceContract = {
  uploadFile: (file: File, kind?: string) => Promise<UploadedFile>;
  uploadDataUrlAsFile: (
    dataUrl: string,
    kind?: string,
    nameHint?: string,
  ) => Promise<UploadedFile>;
};

export function createMediaFacade(mediaService: MediaServiceContract) {
  return {
    uploadFile(file: File, kind = "file") {
      return mediaService.uploadFile(file, kind);
    },
    uploadDataUrlAsFile(dataUrl: string, kind = "file", nameHint = "upload") {
      return mediaService.uploadDataUrlAsFile(dataUrl, kind, nameHint);
    },
  };
}
