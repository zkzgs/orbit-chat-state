import { nextTick, onMounted, onScopeDispose, ref, watch, type Ref } from 'vue'
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
  let userScrolling = false
  let lastScrollTop = 0
  let releaseTimer = 0
  let smoothTimer = 0

  function markProgrammatic(element: HTMLElement, duration = 80) {
    programmatic = true
    lastScrollTop = element.scrollTop
    window.clearTimeout(smoothTimer)
    smoothTimer = window.setTimeout(() => {
      programmatic = false
      lastScrollTop = element.scrollTop
      if (follow.value) follow.value = isNearBottom(element)
    }, duration)
  }

  function syncFollowFromScroll() {
    const element = container.value
    if (!element || programmatic) {
      if (element) lastScrollTop = element.scrollTop
      return
    }
    // 任何上滑都视为离开底部, 阈值只用于回到底部后恢复跟随
    if (element.scrollTop + 1 < lastScrollTop) follow.value = false
    else if (isNearBottom(element)) follow.value = true
    lastScrollTop = element.scrollTop
  }

  function beginUserScroll() {
    userScrolling = true
    window.clearTimeout(releaseTimer)
  }

  function endUserScroll() {
    window.clearTimeout(releaseTimer)
    releaseTimer = window.setTimeout(() => {
      userScrolling = false
      const element = container.value
      if (element && isNearBottom(element)) follow.value = true
    }, 120)
  }

  function onWheel(event: WheelEvent) {
    // 用户主动上滑时立刻取消跟随，避免与程序滚底抢滚动条
    if (event.deltaY < 0) {
      follow.value = false
      beginUserScroll()
      endUserScroll()
    }
  }

  function onTouchMove(event: TouchEvent) {
    if (!event.touches.length) return
    beginUserScroll()
    const element = container.value
    if (!element) return
    if (element.scrollTop + 1 < lastScrollTop) follow.value = false
  }

  function onImageLoad(event: Event) {
    if (
      event.target instanceof HTMLImageElement &&
      event.target.closest('.chat-view')
    )
      scroll()
  }

  watch(
    container,
    (element, _previous, onCleanup) => {
      if (!element) return
      lastScrollTop = element.scrollTop
      element.addEventListener('scroll', syncFollowFromScroll, {
        passive: true,
      })
      element.addEventListener('wheel', onWheel, { passive: true })
      element.addEventListener('touchstart', beginUserScroll, { passive: true })
      element.addEventListener('touchmove', onTouchMove, { passive: true })
      element.addEventListener('touchend', endUserScroll, { passive: true })
      element.addEventListener('load', onImageLoad, true)
      onCleanup(() => {
        element.removeEventListener('scroll', syncFollowFromScroll)
        element.removeEventListener('wheel', onWheel)
        element.removeEventListener('touchstart', beginUserScroll)
        element.removeEventListener('touchmove', onTouchMove)
        element.removeEventListener('touchend', endUserScroll)
        element.removeEventListener('load', onImageLoad, true)
      })
    },
    { immediate: true },
  )

  function scroll(force = false, behavior: ScrollBehavior = 'auto') {
    if (!visible()) return
    if (force) {
      follow.value = true
      pendingForce = true
    } else if (!follow.value && !pendingForce) return
    if (userScrolling && !force) return
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      void nextTick(() => {
        const element = container.value
        const forceScroll = pendingForce
        pendingForce = false
        if (!element || !visible()) return
        if (!forceScroll && (!follow.value || userScrolling)) return
        const smooth = behavior === 'smooth' && forceScroll
        if (smooth) {
          programmatic = true
          element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
          const finish = () => {
            element.removeEventListener('scrollend', finish)
            markProgrammatic(element, 32)
          }
          element.addEventListener('scrollend', finish, { once: true })
          markProgrammatic(element, 500)
        } else {
          programmatic = true
          element.scrollTop = element.scrollHeight
          lastScrollTop = element.scrollTop
          requestAnimationFrame(() => {
            lastScrollTop = element.scrollTop
            programmatic = false
            if (forceScroll || follow.value) follow.value = isNearBottom(element)
          })
        }
      })
    })
  }

  function stickToBottom(smooth = false) {
    follow.value = true
    userScrolling = false
    scroll(true, smooth ? 'smooth' : 'auto')
  }

  onMounted(() => stickToBottom(false))

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
      stickToBottom(false)
    },
  )
  onScopeDispose(() => {
    cancelAnimationFrame(frame)
    window.clearTimeout(releaseTimer)
    window.clearTimeout(smoothTimer)
  })

  return { follow, stickToBottom }
}
