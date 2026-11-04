import { nextTick, onMounted, watch, type Ref } from 'vue'

export function useTextarea(
  element: Ref<HTMLTextAreaElement | null>,
  value: Ref<string>,
  active: () => boolean,
  maxHeight = 260,
) {
  function resize() {
    if (!active() || !element.value) return
    element.value.style.height = 'auto'
    element.value.style.height = `${Math.min(maxHeight, element.value.scrollHeight)}px`
  }
  watch([value, active], () => nextTick(resize))
  onMounted(resize)
  return { resize }
}
