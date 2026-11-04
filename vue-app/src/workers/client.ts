import ImageWorker from './image-worker.ts?worker&inline'
import type { WorkerPayloads, WorkerResults } from '../types/image-worker'
let imageWorker: Worker | null = null
let imageWorkerUnavailable = false
let imageWorkerRequestId = 0
const imageWorkerRequests = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>()

export function getImageWorker(): Worker | null {
  if (imageWorker || imageWorkerUnavailable || typeof Worker === 'undefined')
    return imageWorker
  try {
    imageWorker = new ImageWorker()
    imageWorker.onmessage = (event: MessageEvent) => {
      const { id, result, error } = event.data || {}
      const request = imageWorkerRequests.get(id)
      if (!request) return
      imageWorkerRequests.delete(id)
      if (error) request.reject(new Error(error))
      else request.resolve(result)
    }
    imageWorker.onerror = () => {
      imageWorkerUnavailable = true
      disposeImageWorker('图片 Worker 不可用')
    }
    return imageWorker
  } catch {
    imageWorkerUnavailable = true
    disposeImageWorker('图片 Worker 创建失败')
    return null
  }
}

export function disposeImageWorker(message = '图片 Worker 已停止') {
  imageWorker?.terminate()
  imageWorker = null
  imageWorkerRequests.forEach(
    ({ reject }: { reject: (error: Error) => void }) =>
      reject(new Error(message)),
  )
  imageWorkerRequests.clear()
}

export function runImageWorker<K extends keyof WorkerPayloads>(
  type: K,
  payload: WorkerPayloads[K],
): Promise<WorkerResults[K]> {
  const worker = getImageWorker()
  if (!worker) return Promise.reject(new Error('图片 Worker 不可用'))
  const id = ++imageWorkerRequestId
  return new Promise<WorkerResults[K]>((resolve, reject) => {
    imageWorkerRequests.set(id, {
      resolve: (value) => resolve(value as WorkerResults[K]),
      reject,
    })
    try {
      worker.postMessage({ id, type, payload })
    } catch (error) {
      imageWorkerRequests.delete(id)
      reject(error)
    }
  })
}
