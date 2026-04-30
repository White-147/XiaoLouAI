import { uploadVideo } from '@/api/upload'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useCanvas } from '@/contexts/canvas'
import { normalizeJaazApiUrl } from '@/lib/jaaz-url'
import { cn } from '@/lib/utils'
import {
  convertToExcalidrawElements,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw'
import { Loader2, Video } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import CanvasMenuButton from './CanvasMenuButton'
import { ToolType } from './CanvasMenuIcon'

function getVideoSize(file: File) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      const width = video.videoWidth || 640
      const height = video.videoHeight || 360
      URL.revokeObjectURL(url)
      resolve({ width, height })
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ width: 640, height: 360 })
    }
    video.src = url
  })
}

function fitVideoSize(size: { width: number; height: number }) {
  const maxWidth = 720
  const scale = Math.min(1, maxWidth / Math.max(size.width, 1))
  return {
    width: Math.max(120, Math.round(size.width * scale)),
    height: Math.max(80, Math.round(size.height * scale)),
  }
}

const CanvasToolMenu = () => {
  const { excalidrawAPI } = useCanvas()
  const { t } = useTranslation()

  const [activeTool, setActiveTool] = useState<ToolType | undefined>(undefined)
  const [isUploadingVideo, setIsUploadingVideo] = useState(false)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const handleToolChange = (tool: ToolType) => {
    excalidrawAPI?.setActiveTool({ type: tool })
  }

  const handleUploadVideo = async (file: File) => {
    if (!excalidrawAPI) return
    if (!file.type.startsWith('video/')) {
      toast.error(t('canvas:messages.failedToCreateFile'))
      return
    }

    setIsUploadingVideo(true)
    try {
      const [metadata, uploadResult] = await Promise.all([
        getVideoSize(file),
        uploadVideo(file),
      ])
      const appState = excalidrawAPI.getAppState()
      const container = document.querySelector('.excalidraw')
      const rect = container?.getBoundingClientRect()
      const center = rect
        ? viewportCoordsToSceneCoords(
            {
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
            },
            {
              zoom: appState.zoom,
              offsetLeft: appState.offsetLeft,
              offsetTop: appState.offsetTop,
              scrollX: appState.scrollX,
              scrollY: appState.scrollY,
            }
          )
        : { x: 0, y: 0 }
      const size = fitVideoSize(metadata)
      const videoUrl = normalizeJaazApiUrl(uploadResult.url)
      const videoElements = convertToExcalidrawElements([
        {
          type: 'embeddable',
          id: `video-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          x: center.x - size.width / 2,
          y: center.y - size.height / 2,
          width: size.width,
          height: size.height,
          link: videoUrl,
          strokeColor: '#000000',
          backgroundColor: 'transparent',
          fillStyle: 'solid',
          strokeWidth: 1,
          strokeStyle: 'solid',
          roundness: null,
          roughness: 1,
          opacity: 100,
          angle: 0,
          seed: Math.random(),
          version: 1,
          versionNonce: Math.random(),
          locked: false,
          isDeleted: false,
          groupIds: [],
          boundElements: [],
          updated: Date.now(),
          frameId: null,
          index: null,
          customData: {},
        },
      ])

      excalidrawAPI.updateScene({
        elements: [...excalidrawAPI.getSceneElements(), ...videoElements],
      })
      toast.success(t('canvas:tool.videoUpload'))
    } catch (error) {
      toast.error(t('canvas:messages.failedToCreateFile'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsUploadingVideo(false)
    }
  }

  excalidrawAPI?.onChange((_elements, appState, _files) => {
    setActiveTool(appState.activeTool.type as ToolType)
  })

  const tools: (ToolType | null)[] = [
    'hand',
    'selection',
    null,
    'rectangle',
    'ellipse',
    'arrow',
    'line',
    'freedraw',
    'eraser',
    null,
    'text',
    'image',
  ]

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-primary-foreground/75 backdrop-blur-lg rounded-lg p-1 shadow-[0_5px_10px_rgba(0,0,0,0.08)] border border-primary/10">
      {tools.map((tool, index) =>
        tool ? (
          <CanvasMenuButton
            key={tool}
            type={tool}
            activeTool={activeTool}
            onClick={() => handleToolChange(tool)}
          />
        ) : (
          <Separator
            key={index}
            orientation="vertical"
            className="h-6! bg-primary/5"
          />
        )
      )}
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.currentTarget.value = ''
          if (file) {
            void handleUploadVideo(file)
          }
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={isUploadingVideo}
            className={cn(
              'p-2 rounded-md cursor-pointer hover:bg-primary/5',
              isUploadingVideo && 'opacity-70'
            )}
            onMouseDown={(e) => {
              e.preventDefault()
              videoInputRef.current?.click()
            }}
          >
            {isUploadingVideo ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Video className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('canvas:tool.videoUpload')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export default CanvasToolMenu
