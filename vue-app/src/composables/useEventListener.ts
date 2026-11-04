import { onMounted, onScopeDispose, toValue, type MaybeRefOrGetter } from 'vue'

export function useEventListener<K extends keyof WindowEventMap>(
  target: MaybeRefOrGetter<Window | null>,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void
export function useEventListener(
  target: MaybeRefOrGetter<EventTarget | null>,
  type: string,
  listener: EventListener,
  options?: AddEventListenerOptions,
): void
export function useEventListener(
  target: MaybeRefOrGetter<EventTarget | null>,
  type: string,
  listener: EventListener,
  options?: AddEventListenerOptions,
) {
  let element: EventTarget | null = null
  onMounted(() => {
    element = toValue(target)
    element?.addEventListener(type, listener, options)
  })
  onScopeDispose(() => element?.removeEventListener(type, listener, options))
}
