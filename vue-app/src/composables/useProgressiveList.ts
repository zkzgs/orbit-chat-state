import { computed, onScopeDispose, ref, watch } from 'vue'

export function useProgressiveList<T extends { id: string }>(items: () => T[]) {
  const count = ref(4)
  let previousIds = new Set<string>()
  let timer = 0
  watch(
    items,
    (value) => {
      const nextIds = new Set(value.map((item) => item.id))
      const keepsCurrentItems = [...previousIds].every((id) => nextIds.has(id))
      previousIds = nextIds
      window.clearTimeout(timer)
      if (!keepsCurrentItems) count.value = 4
      function append() {
        count.value = Math.min(count.value + 4, value.length)
        if (count.value < value.length) timer = window.setTimeout(append, 16)
      }
      if (value.length > count.value) timer = window.setTimeout(append, 16)
    },
    { immediate: true },
  )
  onScopeDispose(() => window.clearTimeout(timer))
  return computed(() => items().slice(0, count.value))
}
