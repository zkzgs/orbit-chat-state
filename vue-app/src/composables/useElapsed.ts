import { computed, onScopeDispose, ref, watch } from 'vue'

export function useElapsed(
  start: () => number,
  end: () => number,
  running: () => boolean,
) {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined
  watch(
    running,
    (active) => {
      clearInterval(timer)
      if (active) {
        now.value = Date.now()
        timer = setInterval(() => {
          now.value = Date.now()
        }, 1000)
      }
    },
    { immediate: true },
  )
  onScopeDispose(() => clearInterval(timer))
  return computed(() =>
    Math.max(0, (running() ? now.value : end() || start()) - start()),
  )
}
