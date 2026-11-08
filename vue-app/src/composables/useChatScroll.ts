import { nextTick, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useChatStore } from '../stores/chat'

const BOTTOM_THRESHOLD = 80

function isNearBottom(element: HTMLElement) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    BOTTOM_THRESHOLD
  )
}

export function useChatScroll(
  container: Ref<HTMLElement | null>,
  content: () => unknown,
  conversation: () => string | null,
  visible: () => boolean,
) {
  const chat = useChatStore()
  const follow = ref(true)
  let frame = 0
  let programmatic = false
  let pendingForce = false

  function syncFollowFromScroll() {
    const element = container.value
    if (!element || programmatic) return
    follow.value = isNearBottom(element)
  }

  function onWheel(event: WheelEvent) {
    // 用户主动上滑时立刻取消跟随，避免与程序滚底抢滚动条
    if (event.deltaY < 0) follow.value = false
  }

  watch(
    container,
    (element, _previous, onCleanup) => {
      if (!element) return
      element.addEventListener('scroll', syncFollowFromScroll, { passive: true })
      element.addEventListener('wheel', onWheel, { passive: true })
      onCleanup(() => {
        element.removeEventListener('scroll', syncFollowFromScroll)
        element.removeEventListener('wheel', onWheel)
      })
    },
    { immediate: true },
  )

  function scroll(force = false) {
    if (!visible()) return
    if (force) {
      follow.value = true
      pendingForce = true
    } else if (!follow.value && !pendingForce) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      void nextTick(() => {
        const element = container.value
        const forceScroll = pendingForce
        pendingForce = false
        if (!element || !visible()) return
        if (!forceScroll && !follow.value) return
        programmatic = true
        element.scrollTop = element.scrollHeight
        requestAnimationFrame(() => {
          programmatic = false
          if (forceScroll || follow.value) follow.value = isNearBottom(element)
        })
      })
    })
  }

  function stickToBottom() {
    follow.value = true
    scroll(true)
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
  // 用户点发送后强制恢复跟随（即使当前不在底部）
  watch(
    () => chat.stickToBottomTick,
    () => {
      if (!chat.stickToBottomTick) return
      stickToBottom()
    },
  )
  onScopeDispose(() => cancelAnimationFrame(frame))

  return { follow, stickToBottom }
}
