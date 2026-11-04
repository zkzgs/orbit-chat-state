import { toRaw } from 'vue'

// 导出和 IndexedDB 需要普通数据, 不保留 Vue 代理
export function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value))) as T
}
