import { shallowRef, watch } from 'vue'
import { inspectImage } from '../utils/images'
import type { ImageInfo } from '../types/image-worker'

export function useImageInfo(source: () => string) {
  const info = shallowRef<ImageInfo | null>(null)
  watch(
    source,
    async (value, _, onCleanup) => {
      let active = true
      onCleanup(() => {
        active = false
      })
      info.value = null
      if (!value) return
      try {
        const result = await inspectImage(value)
        if (active) info.value = result
      } catch {
        /* 跨域图片可能允许预览但禁止读取像素 */
      }
    },
    { immediate: true },
  )
  return info
}
