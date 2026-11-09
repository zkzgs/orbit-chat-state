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
  let boundWrap: HTMLElement | null = null
  const pointers = new Map<number, PointerEvent>()
  let pinch: {
    distance: number
    scale: number
    x: number
    y: number
    centerX: number
    centerY: number
  } | null = null
  // Panzoom's built-in focal zoom assumes the image starts at its parent's
  // top-left (plus margins). Our image is grid-centered: that layout offset
  // must be included, for wheel AND pinch. Recover the invariant layout
  // geometry from the rendered matrix, then use Panzoom's current state so
  // consecutive input events don't depend on a requestAnimationFrame paint.
  function geometry() {
    const element = image.value!
    const rect = element.getBoundingClientRect()
    const transform = getComputedStyle(element).transform
    const matrix = new DOMMatrixReadOnly(
      transform === 'none' ? undefined : transform,
    )
    return {
      x: rect.left + rect.width / 2 - matrix.e,
      y: rect.top + rect.height / 2 - matrix.f,
      width: rect.width / matrix.a,
      height: rect.height / matrix.d,
    }
  }
  function boundedScale(value: number) {
    const options = panzoom!.getOptions()
    return Math.min(options.maxScale!, Math.max(options.minScale!, value))
  }
  function placeZoom(value: number, centerX: number, centerY: number) {
    if (!panzoom) return
    const base = geometry()
    panzoom.zoom(value, { animate: false })
    // Panzoom applies scale() translate(): translation is in unscaled units.
    panzoom.pan((centerX - base.x) / value, (centerY - base.y) / value, {
      animate: false,
      force: true,
    })
  }
  function beginPinch() {
    if (!panzoom || pointers.size < 2) return
    const [a, b] = [...pointers.values()]
    const base = geometry()
    const currentScale = panzoom.getScale()
    const currentPan = panzoom.getPan()
    pinch = {
      distance: Math.max(
        1,
        Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
      ),
      scale: currentScale,
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
      centerX: base.x + currentPan.x * currentScale,
      centerY: base.y + currentPan.y * currentScale,
    }
  }
  function pointerDown(event: PointerEvent) {
    if (
      !panzoom ||
      event.button !== 0 ||
      (event.target as Element).closest('.panzoom-exclude')
    )
      return
    pointers.set(event.pointerId, event)
    if (pointers.size === 1) panzoom.handleDown(event)
    else {
      event.preventDefault()
      if (pointers.size === 2) panzoom.handleUp([...pointers.values()][0])
      beginPinch()
    }
  }
  function pointerMove(event: PointerEvent) {
    if (!panzoom || !pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, event)
    if (pointers.size === 1) {
      panzoom.handleMove(event)
      return
    }
    event.preventDefault()
    if (!pinch) beginPinch()
    if (!pinch) return
    const [a, b] = [...pointers.values()]
    const next = boundedScale(
      (pinch.scale * Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)) /
        pinch.distance,
    )
    const ratio = next / pinch.scale
    placeZoom(
      next,
      (a.clientX + b.clientX) / 2 + (pinch.centerX - pinch.x) * ratio,
      (a.clientY + b.clientY) / 2 + (pinch.centerY - pinch.y) * ratio,
    )
  }
  function pointerUp(event: PointerEvent) {
    if (!panzoom || !pointers.has(event.pointerId)) return
    const wasPinching = pointers.size > 1
    pointers.delete(event.pointerId)
    pinch = null
    if (!wasPinching) panzoom.handleUp(event)
    else if (pointers.size === 1) panzoom.handleDown([...pointers.values()][0])
    else if (pointers.size > 1) beginPinch()
  }
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
    if (pointers.size <= 1 && detail.scale <= 1.001) resetPanzoom(true)
  }
  function destroy() {
    clearTimeout(recenterTimer)
    clearTimeout(settleTimer)
    boundImage?.removeEventListener('panzoomchange', onChange)
    boundImage?.removeEventListener('panzoomstart', onStart)
    boundImage?.removeEventListener('panzoomend', onEnd)
    boundWrap?.removeEventListener('pointerdown', pointerDown)
    document.removeEventListener('pointermove', pointerMove)
    document.removeEventListener('pointerup', pointerUp)
    document.removeEventListener('pointercancel', pointerUp)
    boundWrap = null
    pointers.clear()
    pinch = null
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
      noBind: true,
    })
    image.value.addEventListener('panzoomchange', onChange)
    image.value.addEventListener('panzoomstart', onStart)
    image.value.addEventListener('panzoomend', onEnd)
    boundImage = image.value
    boundWrap = wrap.value
    boundWrap?.addEventListener('pointerdown', pointerDown)
    document.addEventListener('pointermove', pointerMove, { passive: false })
    document.addEventListener('pointerup', pointerUp)
    document.addEventListener('pointercancel', pointerUp)
  }
  function wheel(event: WheelEvent) {
    if (!panzoom || (event.target as HTMLElement).closest('.panzoom-exclude'))
      return
    event.preventDefault()
    const delta =
      event.deltaY === 0 && event.deltaX ? event.deltaX : event.deltaY
    if (!delta) return
    const currentScale = panzoom.getScale()
    const currentPan = panzoom.getPan()
    const base = geometry()
    const centerX = base.x + currentPan.x * currentScale
    const centerY = base.y + currentPan.y * currentScale
    const inside =
      Math.abs(event.clientX - centerX) <= (base.width * currentScale) / 2 &&
      Math.abs(event.clientY - centerY) <= (base.height * currentScale) / 2
    const anchorX = inside ? event.clientX : centerX
    const anchorY = inside ? event.clientY : centerY
    const next = boundedScale(
      currentScale *
        Math.exp(((delta < 0 ? 1 : -1) * panzoom.getOptions().step!) / 3),
    )
    if (next === currentScale) return
    const ratio = next / currentScale
    placeZoom(
      next,
      anchorX + (centerX - anchorX) * ratio,
      anchorY + (centerY - anchorY) * ratio,
    )
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
