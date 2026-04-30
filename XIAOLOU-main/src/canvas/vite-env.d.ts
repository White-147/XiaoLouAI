/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MODAL_CAMERA_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
