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
