interface ElectronAPI {
  publishPost: (data: {
    channel: string
    title: string
    content: string
    images: string[]
    video: string
  }) => Promise<{ success?: boolean; error?: string }>
  pickImage: () => Promise<string[] | null>
  pickVideo: () => Promise<string | null>
  installComfyUI: () => Promise<{ success: boolean; error?: string }>
  uninstallComfyUI: () => Promise<{ success: boolean; error?: string }>
  cancelComfyUIInstall: () => Promise<{
    success?: boolean
    error?: string
    message?: string
  }>
  checkComfyUIInstalled: () => Promise<boolean>
  // ComfyUI process management methods
  startComfyUIProcess: () => Promise<{ success: boolean; message?: string }>
  stopComfyUIProcess: () => Promise<{ success: boolean; message?: string }>
  getComfyUIProcessStatus: () => Promise<{ running: boolean; pid?: number }>
  // Auto-updater methods
  checkForUpdates: () => Promise<{ message: string }>
  restartAndInstall: () => Promise<void>
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => void
  removeUpdateDownloadedListener: () => void
  // Auth methods
  openBrowserUrl: (url: string) => Promise<{ success: boolean; error?: string }>
}

interface UpdateInfo {
  version: string
  files: unknown[]
  path: string
  sha512: string
  releaseDate: string
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
