import { saveCanvas } from '@/api/canvas'
import { useCanvas } from '@/contexts/canvas'
import useDebounce from '@/hooks/use-debounce'
import { useTheme } from '@/hooks/use-theme'
import { eventBus } from '@/lib/event'
import { normalizeJaazApiUrl } from '@/lib/jaaz-url'
import {
  getAllowedXiaolouParentOrigins,
  postXiaolouAgentCanvasProject,
  postXiaolouAgentCanvasProjectSaveResult,
} from '@/lib/xiaolou-embed'
import * as ISocket from '@/types/socket'
import { CanvasData } from '@/types/types'
import {
  Excalidraw,
  convertToExcalidrawElements,
  getDataURL,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw'
import {
  ExcalidrawImageElement,
  ExcalidrawEmbeddableElement,
  OrderedExcalidrawElement,
  Theme,
  NonDeleted,
  FileId,
} from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'
import {
  AppState,
  BinaryFileData,
  BinaryFiles,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { VideoElement } from './VideoElement'

import '@/assets/style/canvas.css'

type LastImagePosition = {
  x: number
  y: number
  width: number
  height: number
  col: number // col index
}

type CanvasExcaliProps = {
  canvasId: string
  initialData?: ExcalidrawInitialDataState
}

type XiaolouAgentCanvasProjectSaveRequestMessage = {
  type: 'xiaolou:agent-canvas-project:save-request'
  requestId?: string
}

const SVG_PASTE_MAX_SIZE = 720
const CANVAS_THUMBNAIL_MAX_SIZE = 640
const CANVAS_EMBEDDED_IMAGE_MAX_SIZE = 1600
const CANVAS_DATA_IMAGE_COMPACT_THRESHOLD = 700_000

function normalizeCanvasFiles(
  files?: ExcalidrawInitialDataState['files'] | BinaryFiles
) {
  if (!files) return files

  return Object.fromEntries(
    Object.entries(files).map(([id, file]) => [
      id,
      {
        ...file,
        dataURL: normalizeJaazApiUrl(String(file.dataURL || '')),
      },
    ])
  ) as BinaryFiles
}

function normalizeInitialCanvasData(
  data?: ExcalidrawInitialDataState
): ExcalidrawInitialDataState | null {
  if (!data) return null

  return {
    ...data,
    appState: data.appState
      ? {
          ...data.appState,
          collaborators: undefined!,
        }
      : data.appState,
    files: normalizeCanvasFiles(data.files),
  }
}

function isCompressibleDataImage(dataURL?: string | null) {
  return /^data:image\/(png|jpe?g|webp);base64,/i.test(String(dataURL || ''))
}

function compressDataImage(
  dataURL: string,
  maxSize: number,
  quality = 0.82
): Promise<string> {
  if (!isCompressibleDataImage(dataURL)) return Promise.resolve(dataURL)

  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      try {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
        const width = Math.max(1, Math.round(image.width * scale))
        const height = Math.max(1, Math.round(image.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          resolve(dataURL)
          return
        }
        context.drawImage(image, 0, 0, width, height)
        const compressed = canvas.toDataURL('image/webp', quality)
        resolve(compressed.length < dataURL.length ? compressed : dataURL)
      } catch {
        resolve(dataURL)
      }
    }
    image.onerror = () => resolve(dataURL)
    image.src = dataURL
  })
}

function collectReferencedFileIds(
  elements: Readonly<OrderedExcalidrawElement[]>
) {
  const referenced = new Set<string>()
  elements.forEach((element) => {
    const fileId = (element as { fileId?: string | null }).fileId
    if (fileId && !(element as { isDeleted?: boolean }).isDeleted) {
      referenced.add(fileId)
    }
  })
  return referenced
}

async function compactCanvasFiles(
  elements: Readonly<OrderedExcalidrawElement[]>,
  files: BinaryFiles
) {
  const referenced = collectReferencedFileIds(elements)
  const compactedEntries = await Promise.all(
    Object.entries(files || {})
      .filter(([id]) => referenced.has(id))
      .map(async ([id, file]) => {
        const rawDataURL = String(file.dataURL || '')
        const shouldCompact =
          isCompressibleDataImage(rawDataURL) &&
          rawDataURL.length > CANVAS_DATA_IMAGE_COMPACT_THRESHOLD
        const dataURL = shouldCompact
          ? await compressDataImage(rawDataURL, CANVAS_EMBEDDED_IMAGE_MAX_SIZE)
          : normalizeJaazApiUrl(rawDataURL)
        return [
          id,
          {
            ...file,
            dataURL,
          },
        ] as const
      })
  )
  return Object.fromEntries(compactedEntries) as BinaryFiles
}

function isEditablePasteTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null
  if (!element) return false
  return Boolean(
    element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
  )
}

function getClipboardString(item: DataTransferItem) {
  return new Promise<string>((resolve) => {
    item.getAsString((value) => resolve(value || ''))
  })
}

function extractSvgMarkupFromText(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  const directMatch = trimmed.match(/<svg[\s\S]*<\/svg>/i)
  if (directMatch?.[0]) return directMatch[0]

  try {
    const doc = new DOMParser().parseFromString(trimmed, 'text/html')
    const svg = doc.querySelector('svg')
    return svg ? new XMLSerializer().serializeToString(svg) : null
  } catch {
    return null
  }
}

function sanitizeSvgMarkup(svgMarkup: string) {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return null

  doc
    .querySelectorAll('script, foreignObject, iframe, object, embed, audio, video')
    .forEach((node) => node.remove())

  doc.querySelectorAll('*').forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim().toLowerCase()
      if (
        name.startsWith('on') ||
        ((name === 'href' || name.endsWith(':href')) && value.startsWith('javascript:'))
      ) {
        node.removeAttribute(attr.name)
      }
    })
  })

  const svg = doc.documentElement
  if (svg.nodeName.toLowerCase() !== 'svg') return null
  if (!svg.getAttribute('xmlns')) {
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  }
  return new XMLSerializer().serializeToString(svg)
}

function parseSvgLength(value?: string | null) {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function getSvgDisplaySize(svgMarkup: string) {
  const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml')
  const svg = doc.documentElement
  const viewBox = svg.getAttribute('viewBox') || svg.getAttribute('viewbox')
  const viewBoxParts = viewBox
    ? viewBox.trim().split(/[\s,]+/).map((part) => Number.parseFloat(part))
    : []

  const width =
    parseSvgLength(svg.getAttribute('width')) ||
    (viewBoxParts.length === 4 && viewBoxParts[2] > 0 ? viewBoxParts[2] : null) ||
    320
  const height =
    parseSvgLength(svg.getAttribute('height')) ||
    (viewBoxParts.length === 4 && viewBoxParts[3] > 0 ? viewBoxParts[3] : null) ||
    240

  const scale = Math.min(1, SVG_PASTE_MAX_SIZE / Math.max(width, height))
  return {
    width: Math.max(24, Math.round(width * scale)),
    height: Math.max(24, Math.round(height * scale)),
  }
}

function clipboardMightContainSvg(data: DataTransfer) {
  if (Array.from(data.types || []).includes('image/svg+xml')) return true
  if (Array.from(data.items || []).some((item) => item.type === 'image/svg+xml')) {
    return true
  }
  return Boolean(
    extractSvgMarkupFromText(data.getData('text/plain')) ||
      extractSvgMarkupFromText(data.getData('text/html'))
  )
}

async function readSvgFromClipboard(data: DataTransfer) {
  const directSvg = data.getData('image/svg+xml')
  const directMarkup = extractSvgMarkupFromText(directSvg)
  if (directMarkup) return sanitizeSvgMarkup(directMarkup)

  for (const item of Array.from(data.items || [])) {
    if (item.type === 'image/svg+xml') {
      const file = item.getAsFile()
      const text = file ? await file.text() : await getClipboardString(item)
      const markup = extractSvgMarkupFromText(text)
      if (markup) return sanitizeSvgMarkup(markup)
    }
  }

  const plainMarkup = extractSvgMarkupFromText(data.getData('text/plain'))
  if (plainMarkup) return sanitizeSvgMarkup(plainMarkup)

  const htmlMarkup = extractSvgMarkupFromText(data.getData('text/html'))
  if (htmlMarkup) return sanitizeSvgMarkup(htmlMarkup)

  return null
}

const CanvasExcali: React.FC<CanvasExcaliProps> = ({
  canvasId,
  initialData,
}) => {
  const { excalidrawAPI, setExcalidrawAPI } = useCanvas()

  const { i18n } = useTranslation()

  // Immediate handler for UI updates (no debounce)
  const handleSelectionChange = (
    elements: Readonly<OrderedExcalidrawElement[]>,
    appState: AppState
  ) => {
    if (!appState) return

    // Check if any selected element is embeddable type
    const selectedElements = elements.filter((element) => 
      appState.selectedElementIds[element.id]
    )
    const hasEmbeddableSelected = selectedElements.some(
      (element) => element.type === 'embeddable'
    )

    // Toggle CSS class to hide/show left panel immediately
    const excalidrawContainer = document.querySelector('.excalidraw')
    if (excalidrawContainer) {
      if (hasEmbeddableSelected) {
        excalidrawContainer.classList.add('hide-left-panel')
      } else {
        excalidrawContainer.classList.remove('hide-left-panel')
      }
    }
  }

  const persistCanvas = useCallback(
    async (
      elements: Readonly<OrderedExcalidrawElement[]>,
      appState: AppState,
      files: BinaryFiles,
      source: string
    ) => {
      if (!appState) {
        throw new Error('Canvas is not ready')
      }

      const compactedFiles = await compactCanvasFiles(elements, files)
      const data: CanvasData = {
        elements,
        appState: {
          ...appState,
          collaborators: undefined!,
        },
        files: compactedFiles,
      }

      let thumbnail = ''
      const latestImage = elements
        .filter((element) => element.type === 'image')
        .sort((a, b) => b.updated - a.updated)[0]
      if (latestImage) {
        const file = compactedFiles[latestImage.fileId!]
        if (file) {
          thumbnail = await compressDataImage(
            String(file.dataURL || ''),
            CANVAS_THUMBNAIL_MAX_SIZE,
            0.72
          )
        }
      }

      await saveCanvas(canvasId, { data, thumbnail })
      postXiaolouAgentCanvasProject({
        canvasId,
        thumbnailUrl: thumbnail || undefined,
        source,
      })
    },
    [canvasId]
  )

  // Debounced handler for saving (performance optimization)
  const handleSave = useDebounce(
    (
      elements: Readonly<OrderedExcalidrawElement[]>,
      appState: AppState,
      files: BinaryFiles
    ) => {
      if (elements.length === 0 || !appState) {
        return
      }

      persistCanvas(elements, appState, files, 'canvas_save')
        .catch((error) => {
          console.warn('Failed to save canvas:', error)
        })
    },
    1000
  )

  // Combined handler that calls both immediate and debounced functions
  const handleChange = (
    elements: Readonly<OrderedExcalidrawElement[]>,
    appState: AppState,
    files: BinaryFiles
  ) => {
    // Immediate UI updates
    handleSelectionChange(elements, appState)
    // Debounced save operation
    handleSave(elements, appState, files)
  }

  const saveCurrentCanvasNow = useCallback(
    async (requestId?: string) => {
      if (!excalidrawAPI) {
        throw new Error('Canvas is not ready')
      }

      const elements = excalidrawAPI.getSceneElements()
      const appState = excalidrawAPI.getAppState()
      const files = excalidrawAPI.getFiles()

      await persistCanvas(elements, appState, files, 'canvas_manual_save')
      postXiaolouAgentCanvasProjectSaveResult({
        requestId,
        ok: true,
        canvasId,
      })
    },
    [canvasId, excalidrawAPI, persistCanvas]
  )

  const lastImagePosition = useRef<LastImagePosition | null>(
    localStorage.getItem('excalidraw-last-image-position')
      ? JSON.parse(localStorage.getItem('excalidraw-last-image-position')!)
      : null
  )
  const { theme } = useTheme()

  // 添加自定义类名以便应用我们的CSS修复
  const excalidrawClassName = `excalidraw-custom ${theme === 'dark' ? 'excalidraw-dark-fix-wm76394yjopk' : 'excalidraw-wm76394yjopk'}`
  
  // 在深色模式下使用自定义主题设置，避免使用默认的滤镜
  // 这样可以确保颜色在深色模式下正确显示
  const customTheme = theme === 'dark' ? 'light' : theme
  
  // 在组件挂载和主题变化时设置深色模式下的背景色
  useEffect(() => {
    if (excalidrawAPI && theme === 'dark') {
      // 设置深色背景，但保持light主题以避免颜色反转
      excalidrawAPI.updateScene({
        appState: {
          viewBackgroundColor: '#121212',
          gridColor: 'rgba(255, 255, 255, 0.1)',
        }
      })
    } else if (excalidrawAPI && theme === 'light') {
      // 恢复浅色背景
      excalidrawAPI.updateScene({
        appState: {
          viewBackgroundColor: '#ffffff',
          gridColor: 'rgba(0, 0, 0, 0.1)',
        }
      })
    }
  }, [excalidrawAPI, theme])

  const addImageToExcalidraw = useCallback(
    async (imageElement: ExcalidrawImageElement, file: BinaryFileData) => {
      if (!excalidrawAPI) return

      // 获取当前画布元素以便添加新元素
      const currentElements = excalidrawAPI.getSceneElements()

      const normalizedFile = {
        ...file,
        dataURL: normalizeJaazApiUrl(String(file.dataURL || '')) as BinaryFileData['dataURL'],
      } satisfies BinaryFileData

      excalidrawAPI.addFiles([normalizedFile])

      console.log('👇 Adding new image element to canvas:', imageElement.id)
      console.log('👇 Image element properties:', {
        id: imageElement.id,
        type: imageElement.type,
        locked: imageElement.locked,
        groupIds: imageElement.groupIds,
        isDeleted: imageElement.isDeleted,
        x: imageElement.x,
        y: imageElement.y,
        width: imageElement.width,
        height: imageElement.height,
      })

      // Ensure image is not locked and can be manipulated
      const unlockedImageElement = {
        ...imageElement,
        locked: false,
        groupIds: [],
        isDeleted: false,
      }

      excalidrawAPI.updateScene({
        elements: [...(currentElements || []), unlockedImageElement],
      })

      localStorage.setItem(
        'excalidraw-last-image-position',
        JSON.stringify(lastImagePosition.current)
      )
    },
    [excalidrawAPI]
  )

  const addSvgToExcalidraw = useCallback(
    async (svgMarkup: string) => {
      if (!excalidrawAPI) return

      const { width, height } = getSvgDisplaySize(svgMarkup)
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
      const fileId = `svg-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}` as FileId
      const file = new File([svgMarkup], `${fileId}.svg`, {
        type: 'image/svg+xml',
      })
      const dataURL = await getDataURL(file)
      const [element] = convertToExcalidrawElements(
        [
          {
            type: 'image',
            x: center.x - width / 2,
            y: center.y - height / 2,
            width,
            height,
            fileId,
            status: 'saved',
            scale: [1, 1],
            crop: null,
          },
        ],
        { regenerateIds: true }
      ) as ExcalidrawImageElement[]

      await addImageToExcalidraw(element, {
        id: fileId,
        dataURL,
        mimeType: file.type as BinaryFileData['mimeType'],
        created: Date.now(),
      })
    },
    [addImageToExcalidraw, excalidrawAPI]
  )

  const addVideoEmbed = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (elementData: any, videoSrc: string) => {
      if (!excalidrawAPI) return

      // Function to create video element with given dimensions
      const createVideoElement = (finalWidth: number, finalHeight: number) => {
        console.log('👇 Video element properties:', {
          id: elementData.id,
          type: elementData.type,
          locked: elementData.locked,
          groupIds: elementData.groupIds,
          isDeleted: elementData.isDeleted,
          x: elementData.x,
          y: elementData.y,
          width: elementData.width,
          height: elementData.height,
        })

        const videoElements = convertToExcalidrawElements([
          {
            type: 'embeddable',
            id: elementData.id,
            x: elementData.x,
            y: elementData.y,
            width: elementData.width,
            height: elementData.height,
            link: videoSrc,
            // 添加必需的基本样式属性
            strokeColor: '#000000',
            backgroundColor: 'transparent',
            fillStyle: 'solid',
            strokeWidth: 1,
            strokeStyle: 'solid',
            roundness: null,
            roughness: 1,
            opacity: 100,
            // 添加必需的变换属性
            angle: 0,
            seed: Math.random(),
            version: 1,
            versionNonce: Math.random(),
            // 添加必需的状态属性
            locked: false,
            isDeleted: false,
            groupIds: [],
            // 添加绑定框属性
            boundElements: [],
            updated: Date.now(),
            // 添加必需的索引和帧ID属性
            frameId: null,
            index: null, // 添加缺失的index属性
            // 添加自定义数据属性
            customData: {},
          },
        ])

        console.log('👇 Converted video elements:', videoElements)

        const currentElements = excalidrawAPI.getSceneElements()
        const newElements = [...currentElements, ...videoElements]

        console.log(
          '👇 Updating scene with elements count:',
          newElements.length
        )

        excalidrawAPI.updateScene({
          elements: newElements,
        })

        console.log(
          '👇 Added video embed element:',
          videoSrc,
          `${elementData.width}x${elementData.height}`
        )
      }

      // If dimensions are provided, use them directly
      if (elementData.width && elementData.height) {
        createVideoElement(elementData.width, elementData.height)
        return
      }

      // Otherwise, try to get video's natural dimensions
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'

      video.onloadedmetadata = () => {
        const videoWidth = video.videoWidth
        const videoHeight = video.videoHeight

        if (videoWidth && videoHeight) {
          // Scale down if video is too large (max 800px width)
          const maxWidth = 800
          let finalWidth = videoWidth
          let finalHeight = videoHeight

          if (videoWidth > maxWidth) {
            const scale = maxWidth / videoWidth
            finalWidth = maxWidth
            finalHeight = videoHeight * scale
          }

          createVideoElement(finalWidth, finalHeight)
        } else {
          // Fallback to default dimensions
          createVideoElement(320, 180)
        }
      }

      video.onerror = () => {
        console.warn('Could not load video metadata, using default dimensions')
        createVideoElement(320, 180)
      }

      video.src = videoSrc
    },
    [excalidrawAPI]
  )

  const renderEmbeddable = useCallback(
    (element: NonDeleted<ExcalidrawEmbeddableElement>, appState: AppState) => {
      const { link } = element

      // Check if this is a video URL
      if (
        link &&
        (link.includes('.mp4') ||
          link.includes('.webm') ||
          link.includes('.ogg') ||
          link.startsWith('blob:') ||
          link.includes('video'))
      ) {
        // Return the VideoPlayer component
        return (
          <VideoElement
            src={link}
            width={element.width}
            height={element.height}
          />
        )
      }

      console.log('👇 Not a video URL, returning null for:', link)
      // Return null for non-video embeds to use default rendering
      return null
    },
    []
  )

  const handleImageGenerated = useCallback(
    (imageData: ISocket.SessionImageGeneratedEvent) => {
      console.log('👇 CanvasExcali received image_generated:', imageData)

      // Only handle if it's for this canvas
      if (imageData.canvas_id !== canvasId) {
        console.log('👇 Image not for this canvas, ignoring')
        return
      }

      // Check if this is actually a video generation event that got mislabeled
      if (imageData.file?.mimeType?.startsWith('video/')) {
        console.log(
          '👇 This appears to be a video, not an image. Ignoring in image handler.'
        )
        return
      }

      addImageToExcalidraw(imageData.element, imageData.file)
    },
    [addImageToExcalidraw, canvasId]
  )

  const handleVideoGenerated = useCallback(
    (videoData: ISocket.SessionVideoGeneratedEvent) => {
      console.log('👇 CanvasExcali received video_generated:', videoData)

      // Only handle if it's for this canvas
      if (videoData.canvas_id !== canvasId) {
        console.log('👇 Video not for this canvas, ignoring')
        return
      }

      // Create video embed element using the video URL
      addVideoEmbed(videoData.element, videoData.video_url)
    },
    [addVideoEmbed, canvasId]
  )

  useEffect(() => {
    eventBus.on('Socket::Session::ImageGenerated', handleImageGenerated)
    eventBus.on('Socket::Session::VideoGenerated', handleVideoGenerated)
    return () => {
      eventBus.off('Socket::Session::ImageGenerated', handleImageGenerated)
      eventBus.off('Socket::Session::VideoGenerated', handleVideoGenerated)
    }
  }, [handleImageGenerated, handleVideoGenerated])

  useEffect(() => {
    const handleSvgPaste = (event: ClipboardEvent) => {
      if (!excalidrawAPI || !event.clipboardData) return
      if (isEditablePasteTarget(event.target)) return
      if (!clipboardMightContainSvg(event.clipboardData)) return

      event.preventDefault()
      void readSvgFromClipboard(event.clipboardData)
        .then((svgMarkup) => {
          if (svgMarkup) {
            void addSvgToExcalidraw(svgMarkup)
          }
        })
        .catch((error) => {
          console.warn('Failed to paste SVG into canvas:', error)
        })
    }

    window.addEventListener('paste', handleSvgPaste)
    return () => {
      window.removeEventListener('paste', handleSvgPaste)
    }
  }, [addSvgToExcalidraw, excalidrawAPI])

  useEffect(() => {
    const handleXiaolouSaveRequest = (event: MessageEvent) => {
      if (!getAllowedXiaolouParentOrigins().has(event.origin)) return
      if (event.source !== window.parent) return
      if (event.data?.type !== 'xiaolou:agent-canvas-project:save-request') {
        return
      }

      const message =
        event.data as XiaolouAgentCanvasProjectSaveRequestMessage
      void saveCurrentCanvasNow(message.requestId).catch((error) => {
        postXiaolouAgentCanvasProjectSaveResult({
          requestId: message.requestId,
          ok: false,
          canvasId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    window.addEventListener('message', handleXiaolouSaveRequest)
    return () => {
      window.removeEventListener('message', handleXiaolouSaveRequest)
    }
  }, [canvasId, saveCurrentCanvasNow])

  return (
    <Excalidraw
      theme={customTheme as Theme}
      langCode={i18n.language}
      className={excalidrawClassName}
      excalidrawAPI={(api) => {
        setExcalidrawAPI(api)
      }}
      onChange={handleChange}
      initialData={() => {
        const data = normalizeInitialCanvasData(initialData)
        console.log('👇initialData', data)
        return data || null
      }}
      renderEmbeddable={renderEmbeddable}
      // Allow all URLs for embeddable content
      validateEmbeddable={(url: string) => {
        console.log('👇 Validating embeddable URL:', url)
        // Allow all URLs - return true for everything
        return true
      }}
      // Ensure interactive mode is enabled
      viewModeEnabled={false}
      zenModeEnabled={false}
      // Allow element manipulation
      onPointerUpdate={(payload) => {
        // Minimal logging - only log significant pointer events
        if (payload.button === 'down' && Math.random() < 0.05) {
          // console.log('👇 Pointer down on:', payload.pointer.x, payload.pointer.y)
        }
      }}
    />
  )
}

export { CanvasExcali }
export default CanvasExcali
