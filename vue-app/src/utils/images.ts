import type {
  PreparedReference,
  ReferenceImage,
  Settings,
} from '../types/models'
import type { CompressedImage } from '../types/image-worker'
import { runImageWorker } from '../workers/client'
import { resourceFetch } from '../api/client'
import { readDataUrl } from './files'
import { findImageCompressionCandidate } from './image-compression'
import { createId } from './id'
import { downloadFile } from './files'

export async function readReference(file: File): Promise<ReferenceImage> {
  return {
    id: createId(),
    name: file.name,
    file,
    data: await readDataUrl(file),
  }
}
export async function sourceToFile(source: string, name = 'reference.png') {
  const response = await resourceFetch(source)
  if (!response.ok) throw new Error('图片读取失败')
  return new File([await response.blob()], name, {
    type: response.headers.get('content-type') || 'image/png',
  })
}
async function compressOnMain(
  file: File,
  targetBytes: number,
): Promise<CompressedImage> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    const candidate = await findImageCompressionCandidate(
      (quality) =>
        new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) =>
              blob ? resolve(blob) : reject(new Error('图片压缩失败')),
            'image/webp',
            quality,
          ),
        ),
      targetBytes,
    )
    return {
      compressed: candidate.blob.size < file.size,
      blob: candidate.blob,
      originalWidth: bitmap.width,
      originalHeight: bitmap.height,
      submittedWidth: bitmap.width,
      submittedHeight: bitmap.height,
      quality: candidate.quality,
      targetReached: candidate.targetReached,
    }
  } finally {
    bitmap.close()
  }
}
export async function prepareReferences(
  references: ReferenceImage[],
  settings: Pick<
    Settings,
    'compressRequestImages' | 'requestImageCompressionLimitMb'
  >,
  includeData = false,
): Promise<PreparedReference[]> {
  const result: PreparedReference[] = []
  for (const reference of references) {
    const original =
      reference.file || (await sourceToFile(reference.data, reference.name))
    let file = original
    let compression: CompressedImage | undefined
    const targetBytes = settings.requestImageCompressionLimitMb * 1048576
    if (
      settings.compressRequestImages &&
      original.size > targetBytes &&
      original.type !== 'image/gif'
    ) {
      try {
        compression = await runImageWorker('compressImage', {
          file: original,
          targetBytes,
        })
      } catch {
        compression = await compressOnMain(original, targetBytes)
      }
      if (compression.compressed && compression.blob)
        file = new File(
          [compression.blob],
          `${original.name.replace(/\.[^.]+$/, '')}-compressed.webp`,
          { type: 'image/webp' },
        )
    }
    result.push({
      file,
      data:
        includeData && file !== original
          ? await readDataUrl(file)
          : reference.data,
      submissionMeta: {
        name: file.name,
        originalSize: original.size,
        submittedSize: file.size,
        originalType: original.type,
        submittedType: file.type,
        originalWidth: compression?.originalWidth,
        originalHeight: compression?.originalHeight,
        submittedWidth:
          compression?.submittedWidth || compression?.originalWidth,
        submittedHeight:
          compression?.submittedHeight || compression?.originalHeight,
        compressed: file !== original,
        strategy:
          file !== original
            ? 'quality-only'
            : original.type === 'image/gif'
              ? 'preserve-animation'
              : 'original',
        targetBytes,
        targetReached: file.size <= targetBytes,
        quality: compression?.quality,
      },
    })
  }
  return result
}
export async function inspectImage(source: string) {
  const file = await sourceToFile(source)
  try {
    return await runImageWorker('inspectImage', { blob: file })
  } catch {
    const image = await decodeImage(file)
    const result = {
      width: image.width,
      height: image.height,
      fileSize: file.size,
      format: file.type.split(';')[0].split('/')[1].replace('+xml', ''),
      detectedFormat: file.type.split(';')[0].split('/')[1].replace('+xml', ''),
    }
    image.release()
    return result
  }
}
export async function downloadImage(source: string, name = 'orbit-image') {
  const file = await sourceToFile(source)
  downloadFile(
    file,
    file.type,
    `${name}.${file.type.split(';')[0].split('/')[1]?.replace('+xml', '') || 'png'}`,
  )
}

async function decodeImage(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  return {
    image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  }
}

export async function copyImage(source: string) {
  const file = await sourceToFile(source)
  let blob: Blob = file
  if (file.type !== 'image/png') {
    try {
      blob = await runImageWorker('convertToPng', { blob: file })
    } catch {
      const decoded = await decodeImage(file)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = decoded.width
        canvas.height = decoded.height
        canvas.getContext('2d')!.drawImage(decoded.image, 0, 0)
        blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value ? resolve(value) : reject(new Error('图片转换失败')),
            'image/png',
          ),
        )
      } finally {
        decoded.release()
      }
    }
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
