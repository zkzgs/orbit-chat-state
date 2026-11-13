import { computed, onMounted, onScopeDispose, ref, watch, type Ref } from 'vue'
import { gridLayout } from '../utils/virtual-grid.js'

export function useVirtualGrid<T>(
  element: Ref<HTMLElement | null>,
  items: () => T[],
) {
  const range = ref({ start: 0, end: 12, before: 0, after: 0 })
  let frame = 0
  let observer: ResizeObserver
  let scroller: HTMLElement | null = null
  function update() {
    if (element.value?.clientWidth)
      range.value = gridLayout(element.value, items().length)
  }
  function schedule() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(update)
  }
  watch(items, update, { flush: 'post' })
  onMounted(() => {
    observer = new ResizeObserver(schedule)
    observer.observe(element.value!)
    scroller = element.value!.closest('.content-stage')
    element.value!.addEventListener('scroll', schedule, { passive: true })
    scroller?.addEventListener('scroll', schedule, { passive: true })
    update()
  })
  onScopeDispose(() => {
    cancelAnimationFrame(frame)
    observer?.disconnect()
    element.value?.removeEventListener('scroll', schedule)
    scroller?.removeEventListener('scroll', schedule)
  })
  return {
    visible: computed(() => items().slice(range.value.start, range.value.end)),
    range,
  }
}
