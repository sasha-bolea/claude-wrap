import { IMAGE_TYPES, LIMITS, type Image, type ImageType } from '@athome/protocol'
import { t } from './i18n.ts'

// Images attached to a message: read from pasted, dropped or picked files, checked against the protocol limits.
// Phone photos are downscaled first (long edge ≤ 1568 px, JPEG): smaller uploads, and what the model reads anyway.

export const isImageFile = (file: File) => (IMAGE_TYPES as readonly string[]).includes(file.type)

// The image as a data: URL (allowed by the CSP) for thumbnails.
export const dataUrl = (image: Image) => `data:${image.mediaType};base64,${image.data}`

// Base64 content of a file.
export function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

const MAX_EDGE = 1568
const JPEG_QUALITY = 0.85

// The photo redrawn with its long edge at most MAX_EDGE, as JPEG; undefined when the browser cannot decode it.
async function downscale(file: File): Promise<File | undefined> {
  const bitmap = await createImageBitmap(file).catch(() => undefined)
  if (!bitmap) return undefined
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  return blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : undefined
}

// Reads image files; already: how many images the message has; shrink: downscale photos first (phone).
// Returns the images and one message per refused file.
export async function readImages(files: File[], already: number, shrink = false): Promise<{ images: Image[]; errors: string[] }> {
  const images: Image[] = []
  const errors: string[] = []
  for (const picked of files) {
    const file = shrink && picked.type.startsWith('image/') && picked.type !== 'image/gif' ? ((await downscale(picked)) ?? picked) : picked
    if (!isImageFile(file)) errors.push(t('imageUnsupported', { name: file.name }))
    else if (file.size > LIMITS.imageBytes) errors.push(t('imageTooLarge', { name: file.name, mb: String(LIMITS.imageBytes / 1024 / 1024) }))
    else if (already + images.length >= LIMITS.images) errors.push(t('tooManyImages', { count: String(LIMITS.images) }))
    else images.push({ mediaType: file.type as ImageType, data: await readBase64(file) })
  }
  return { images, errors }
}
