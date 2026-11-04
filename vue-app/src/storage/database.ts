import type { ImageRecord } from '../types/models'
import { IMAGE_DB_NAME, IMAGE_STORE_NAME } from '../constants/workspace'
import { toRaw } from 'vue'

// 递归解除记录中的 Vue 代理, 保留原图字符串, 避免 JSON 序列化复制整张图片。
function toStorageValue<T>(value: T): T {
  const raw = toRaw(value)
  if (Array.isArray(raw)) return raw.map(toStorageValue) as T
  if (!raw || typeof raw !== 'object') return raw
  return Object.fromEntries(
    Object.entries(raw).map(([key, item]) => [key, toStorageValue(item)]),
  ) as T
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, 1)
    request.onupgradeneeded = () =>
      request.result.createObjectStore(IMAGE_STORE_NAME, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function readImages(): Promise<ImageRecord[]> {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const records: ImageRecord[] = []
      const request = db
        .transaction(IMAGE_STORE_NAME)
        .objectStore(IMAGE_STORE_NAME)
        .openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(records)
          return
        }
        records.push(cursor.value as ImageRecord)
        cursor.continue()
      }
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
export async function updateImages(
  records: ImageRecord[] = [],
  deletedIds: string[] = [],
  replace = false,
) {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(IMAGE_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(IMAGE_STORE_NAME)
      if (replace) store.clear()
      deletedIds.forEach((id) => store.delete(id))
      records.forEach((record) => store.put(toStorageValue(record)))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}
