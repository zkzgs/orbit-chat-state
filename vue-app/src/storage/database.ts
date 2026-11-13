import type { ImageRecord } from '../types/models'
import { IMAGE_DB_NAME, IMAGE_STORE_NAME } from '../constants/workspace'
import { toRaw } from 'vue'
import { createImageStorage } from './image-assets.js'
import { runImageWorker } from '../workers/client'
import { resourceFetch } from '../api/client'

export const imageStorage = createImageStorage({
  dbName: IMAGE_DB_NAME,
  storeName: IMAGE_STORE_NAME,
  fetch: (source: string) => resourceFetch(source),
  decode: (source: string) =>
    runImageWorker('dataUrlToBlob', { dataUrl: source }),
  thumbnail: (blob: Blob) => runImageWorker('createThumbnail', { blob }),
})

// 递归解除记录中的 Vue 代理, 不序列化或复制整张图片。
function toStorageValue<T>(value: T): T {
  const raw = toRaw(value)
  if (Array.isArray(raw)) return raw.map(toStorageValue) as T
  if (!raw || typeof raw !== 'object') return raw
  return Object.fromEntries(
    Object.entries(raw).map(([key, item]) => [key, toStorageValue(item)]),
  ) as T
}

export function readImages(onRecords: (records: ImageRecord[]) => void) {
  return imageStorage.readRecords(onRecords)
}

export async function updateImages(
  records: ImageRecord[] = [],
  deletedIds: string[] = [],
  replace = false,
): Promise<ImageRecord[]> {
  return imageStorage.writeRecords(
    records.map(toStorageValue),
    deletedIds,
    replace,
  )
}
