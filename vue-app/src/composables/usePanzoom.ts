import { onScopeDispose, watch, nextTick, ref, type Ref } from 'vue'
import Panzoom, { type PanzoomObject } from '@panzoom/panzoom'

export function usePanzoom(
  image: Ref<HTMLImageElement | null>,
  wrap: Ref<HTMLElement | null>,
  enabled: () => boolean,
  source: () => string,
) {
  let panzoom: PanzoomObject | null = null
  let boundImage: HTMLImageElement | null = null
  let recenterTimer: ReturnType<typeof setTimeout> | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let isRecentering = false
  const scale = ref(1)
  const pan = ref({ x: 0, y: 0 })
  function resetPanzoom(animate = true) {
    if (!panzoom) return
    clearTimeout(recenterTimer)
    clearTimeout(settleTimer)
    isRecentering = true
    panzoom.reset({ animate, duration: 260 })
    settleTimer = setTimeout(
      () => {
        isRecentering = false
        scale.value = 1
        pan.value = { x: 0, y: 0 }
        wrap.value?.classList.remove('is-zoomed', 'is-dragging')
        if (image.value) image.value.style.cursor = 'zoom-in'
      },
      animate ? 270 : 0,
    )
  }
  function onChange(event: Event) {
    const detail = (
      event as CustomEvent<{ x: number; y: number; scale: number }>
    ).detail
    scale.value = detail.scale
    pan.value = { x: detail.x, y: detail.y }
    wrap.value?.classList.toggle('is-zoomed', detail.scale > 1.001)
    if (image.value)
      image.value.style.cursor = detail.scale > 1.001 ? 'grab' : 'zoom-in'
    clearTimeout(recenterTimer)
    if (
      isRecentering ||
      detail.scale > 1.001 ||
      (Math.abs(detail.x) < 1 && Math.abs(detail.y) < 1)
    )
      return
    recenterTimer = setTimeout(() => resetPanzoom(true), 90)
  }
  function onStart() {
    wrap.value?.classList.add('is-dragging')
    if (image.value) image.value.style.cursor = 'grabbing'
  }
  function onEnd(event: Event) {
    wrap.value?.classList.remove('is-dragging')
    const detail = (event as CustomEvent<{ scale: number }>).detail
    if (detail.scale <= 1.001) resetPanzoom(true)
  }
  function destroy() {
    clearTimeout(recenterTimer)
    clearTimeout(settleTimer)
    boundImage?.removeEventListener('panzoomchange', onChange)
    boundImage?.removeEventListener('panzoomstart', onStart)
    boundImage?.removeEventListener('panzoomend', onEnd)
    boundImage = null
    panzoom?.destroy()
    panzoom = null
    scale.value = 1
    pan.value = { x: 0, y: 0 }
    isRecentering = false
    wrap.value?.classList.remove('is-zoomed', 'is-dragging')
  }
  async function initialize() {
    destroy()
    await nextTick()
    if (!enabled() || !image.value) return
    panzoom = Panzoom(image.value, {
      maxScale: 12,
      minScale: 1,
      startScale: 1,
      startX: 0,
      startY: 0,
      step: 0.22,
      panOnlyWhenZoomed: true,
      canvas: true,
      cursor: 'zoom-in',
      animate: false,
      duration: 260,
      excludeClass: 'panzoom-exclude',
    })
    image.value.addEventListener('panzoomchange', onChange)
    image.value.addEventListener('panzoomstart', onStart)
    image.value.addEventListener('panzoomend', onEnd)
    boundImage = image.value
  }
  function wheel(event: WheelEvent) {
    if (!panzoom || (event.target as HTMLElement).closest('.panzoom-exclude'))
      return
    event.preventDefault()
    panzoom.zoomWithWheel(event)
  }
  function reset() {
    resetPanzoom(false)
  }
  watch(
    [enabled, source],
    () => {
      if (!enabled()) destroy()
      else if (image.value?.complete && image.value.naturalWidth)
        void initialize()
    },
    { flush: 'post' },
  )
  onScopeDispose(destroy)
  return { initialize, wheel, reset, scale, pan }
}
