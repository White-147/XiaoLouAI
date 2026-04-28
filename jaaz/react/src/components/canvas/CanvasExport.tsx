import { useCanvas } from '@/contexts/canvas'
import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import { ImageDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { isXiaolouEmbedded } from '@/lib/xiaolou-embed'


const CanvasExport = () => {
  const { excalidrawAPI } = useCanvas()
  const { t } = useTranslation()

  if (isXiaolouEmbedded()) return null

  const downloadImage = async (imageUrl: string): Promise<string> => {
    const image = new Image()
    image.src = imageUrl
    return new Promise((resolve, reject) => {
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(image, 0, 0)
        const dataURL = canvas.toDataURL('image/png')
        resolve(dataURL)
      }
      image.onerror = () => {
        reject(new Error('Failed to load image'))
      }
    })
  }

  const handleExportImages = async () => {
    if (!excalidrawAPI) return
    const toastId = toast.loading(t('canvas:messages.exportingAssets'))
    try {
      const appState = excalidrawAPI.getAppState()
      const elements = excalidrawAPI.getSceneElements()

      const selectedIds = Object.keys(appState.selectedElementIds).filter(
        (id) => appState.selectedElementIds[id]
      )

      const images = elements.filter(
        (element) =>
          selectedIds.includes(element.id) && 
          (element.type === 'image' || element.type === 'embeddable')
      )

      if (images.length === 0) {
        toast.error(t('canvas:messages.nothingSelected'))
        return
      }

      const files = excalidrawAPI.getFiles()

      // Separate embeddable elements (videos) and regular images
      const embeddableElements = images.filter(element => element.type === 'embeddable')
      const imageElements = images.filter(element => element.type === 'image')

      // Get video URLs from embeddable elements
      const videoUrls = embeddableElements
        .map((element) => {
          if ('link' in element && element.link) {
            return element.link
          }
          return null
        })
        .filter((url) => url !== null)

      // Get image URLs from regular image elements
      const imageUrls = imageElements
        .map((element) => {
          if ('fileId' in element && element.fileId) {
            const file = files[element.fileId]
            return file?.dataURL
          }
          return null
        })
        .filter((url) => url !== null)

      if (imageUrls.length === 0 && videoUrls.length === 0) {
        toast.error(t('canvas:messages.nothingSelected'))
        return
      }
      
      // Generate random ID for the asset package
      const randomId = Math.random().toString(36).substring(2, 15)
      const packageName = `Asset-${randomId}.zip`

      // If only one image and no videos, save directly
      if (imageUrls.length === 1 && videoUrls.length === 0) {
        const imageUrl = imageUrls[0]
        const dataURL = await downloadImage(imageUrl)
        saveAs(dataURL, `Asset-${randomId}.png`)
        return
      }

      // If only one video and no images, save directly
      if (videoUrls.length === 1 && imageUrls.length === 0) {
        const videoUrl = videoUrls[0]
        const response = await fetch(videoUrl)
        const blob = await response.blob()
        saveAs(blob, `Asset-${randomId}.mp4`)
        return
      }

      // Create a zip package for multiple assets or mixed types
      const zip = new JSZip()
      
      // Add videos to zip
      await Promise.all(
        videoUrls.map(async (videoUrl, index) => {
          const response = await fetch(videoUrl)
          const blob = await response.blob()
          zip.file(`video-${index + 1}.mp4`, blob)
        })
      )

      // Add images to zip
      await Promise.all(
        imageUrls.map(async (imageUrl, index) => {
          const dataURL = await downloadImage(imageUrl)
          if (dataURL) {
            zip.file(
              `image-${index + 1}.png`,
              dataURL.replace('data:image/png;base64,', ''),
              { base64: true }
            )
          }
        })
      )

      const content = await zip.generateAsync({ type: 'blob' })
      saveAs(content, packageName)
    } catch (error) {
      toast.error(t('canvas:messages.failedToExportImages'), {
        id: toastId,
      })
    } finally {
      toast.dismiss(toastId)
    }
  }

  return (
    <div className="inline-flex -space-x-px rounded-md shadow-xs rtl:space-x-reverse">
      <Button
        className="rounded-none shadow-none first:rounded-s-md last:rounded-e-md h-8"
        variant="outline"
        onClick={handleExportImages}
      >
        <ImageDown />
        {t('canvas:exportImages')}
      </Button>
    </div>
  )
}

export default CanvasExport
