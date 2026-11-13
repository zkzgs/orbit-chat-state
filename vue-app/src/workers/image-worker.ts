/// <reference lib="webworker" />
import { parseImageResponse } from '../utils/image-response'
import { findImageCompressionCandidate } from '../utils/image-compression'
import type {
  WorkerRequest,
  WorkerPayloads,
  WorkerResults,
} from '../types/image-worker'

function normalizeImageFormat(format: string) {
  const value = String(format || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (value === 'jpg') return 'jpeg'
  if (value === 'svg+xml') return 'svg'
  return value
}

function dataUrlToBlob(dataUrl: string) {
  const separator = String(dataUrl || '').indexOf(',')
  if (separator < 0) throw new Error('无效的图片数据')
  const header = String(dataUrl).slice(0, separator)
  const encoded = String(dataUrl).slice(separator + 1)
  const mime = header.match(/^data:([^;]+)/i)?.[1] || 'application/octet-stream'
  if (!header.includes(';base64'))
    return new Blob([decodeURIComponent(encoded)], { type: mime })
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

function blobToDataUrl(blob: Blob) {
  if (typeof FileReaderSync === 'undefined')
    throw new Error('当前浏览器不支持 Worker 文件读取')
  return new FileReaderSync().readAsDataURL(blob)
}

async function detectBlobFormat(blob: Blob) {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (
    String.fromCharCode(...bytes.slice(0, 6)) === 'GIF87a' ||
    String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a'
  )
    return 'gif'
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'webp'
  return normalizeImageFormat(blob.type?.split('/')[1] || '')
}

async function inspectImage(blob: Blob) {
  if (typeof createImageBitmap !== 'function')
    throw new Error('当前浏览器不支持 Worker 图片解码')
  const bitmap = await createImageBitmap(blob)
  const width = bitmap.width
  const height = bitmap.height
  let hasTransparency: boolean | undefined
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const scale = Math.min(1, 512 / Math.max(width, height))
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.round(width * scale)),
        Math.max(1, Math.round(height * scale)),
      )
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data
      hasTransparency = false
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] < 255) {
          hasTransparency = true
          break
        }
      }
    }
  } finally {
    bitmap.close()
  }
  const format = await detectBlobFormat(blob)
  return {
    width,
    height,
    detectedFormat: format,
    format,
    fileSize: blob.size,
    hasTransparency,
  }
}

async function compressImage(file: File, targetBytes: number) {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas === 'undefined'
  )
    throw new Error('当前浏览器不支持 Worker 图片压缩')
  const bitmap = await createImageBitmap(file)
  try {
    const originalWidth = bitmap.width
    const originalHeight = bitmap.height
    const canvas = new OffscreenCanvas(originalWidth, originalHeight)
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0, originalWidth, originalHeight)
    const encode = (quality: number) =>
      canvas.convertToBlob({ type: 'image/webp', quality })
    const {
      blob: candidate,
      quality: candidateQuality,
      targetReached,
    } = await findImageCompressionCandidate(encode, targetBytes)
    if (candidate.size >= file.size)
      return { compressed: false, originalWidth, originalHeight }
    return {
      blob: candidate,
      originalWidth,
      originalHeight,
      submittedWidth: originalWidth,
      submittedHeight: originalHeight,
      quality: candidateQuality,
      compressed: true,
      targetReached,
    }
  } finally {
    bitmap.close()
  }
}

async function convertToPng(blob: Blob) {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas === 'undefined'
  )
    throw new Error('当前浏览器不支持 Worker 图片转换')
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    return await canvas.convertToBlob({ type: 'image/png' })
  } finally {
    bitmap.close()
  }
}

async function createThumbnail(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height))
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    )
    canvas
      .getContext('2d')!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
  } finally {
    bitmap.close()
  }
}

const handlers: {
  [K in keyof WorkerPayloads]: (
    payload: WorkerPayloads[K],
  ) => WorkerResults[K] | Promise<WorkerResults[K]>
} = {
  fileToDataUrl: ({ file }) => blobToDataUrl(file),
  blobToDataUrl: ({ blob }) => blobToDataUrl(blob),
  dataUrlToBlob: ({ dataUrl }) => dataUrlToBlob(dataUrl),
  inspectImage: ({ blob }) => inspectImage(blob),
  compressImage: ({ file, targetBytes }) => compressImage(file, targetBytes),
  convertToPng: ({ blob }) => convertToPng(blob),
  createThumbnail: ({ blob }) => createThumbnail(blob),
  parseImageResponse: ({ raw, endpoint, isEdit }) =>
    parseImageResponse(raw, endpoint, isEdit),
}

const worker = self as unknown as DedicatedWorkerGlobalScope
worker.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data || {}
  try {
    const result = await (
      handlers[type] as (value: WorkerPayloads[keyof WorkerPayloads]) => unknown
    )(payload)
    worker.postMessage({ id, result })
  } catch (error) {
    worker.postMessage({
      id,
      error: (error as Error)?.message || 'Worker 图片处理失败',
    })
  }
}
