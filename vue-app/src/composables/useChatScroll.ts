import { nextTick, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useEventListener } from './useEventListener'

export function useChatScroll(
  container: Ref<HTMLElement | null>,
  content: () => unknown,
  conversation: () => string | null,
  visible: () => boolean,
) {
  const follow = ref(true)
  let frame = 0
  useEventListener(container, 'scroll', () => {
    const element = container.value
    if (element)
      follow.value =
        element.scrollHeight - element.scrollTop - element.clientHeight < 80
  })
  function scroll(force = false) {
    if (!visible() || (!force && !follow.value)) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(async () => {
      await nextTick()
      container.value?.scrollTo({ top: container.value.scrollHeight })
    })
  }
  watch(content, () => scroll(), { deep: true, flush: 'post' })
  watch(
    [conversation, visible],
    () => {
      follow.value = true
      scroll(true)
    },
    { flush: 'post' },
  )
  onScopeDispose(() => cancelAnimationFrame(frame))
}
