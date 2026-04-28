import { compressImageFile } from '@/utils/imageUtils'
import {
  fileNameFromJaazUrl,
  postXiaolouAgentAsset,
} from '@/lib/xiaolou-embed'

export async function uploadImage(
  file: File
): Promise<{ file_id: string; width: number; height: number; url: string }> {
  // Compress image before upload
  const compressedFile = await compressImageFile(file)

  const formData = new FormData()
  formData.append('file', compressedFile)
  const response = await fetch('/api/upload_image', {
    method: 'POST',
    body: formData,
  })
  const result = await response.json()
  postXiaolouAgentAsset({
    fileUrl: result.url,
    fileName: fileNameFromJaazUrl(result.url) || result.file_id || file.name,
    name: file.name,
    mediaKind: 'image',
    mimeType: compressedFile.type || file.type || 'image/jpeg',
    width: result.width,
    height: result.height,
    source: 'upload_image',
  })
  return result
}

export async function uploadVideo(
  file: File
): Promise<{ file_id: string; url: string; mimeType?: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch('/api/upload_video', {
    method: 'POST',
    body: formData,
  })
  const result = await response.json()
  if (!response.ok) {
    throw new Error(result?.detail || result?.message || 'Failed to upload video')
  }
  postXiaolouAgentAsset({
    fileUrl: result.url,
    fileName: fileNameFromJaazUrl(result.url) || result.file_id || file.name,
    name: file.name,
    mediaKind: 'video',
    mimeType: result.mimeType || file.type || 'video/mp4',
    source: 'upload_video',
  })
  return result
}
