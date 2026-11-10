import { onMounted, onScopeDispose, watch, nextTick, type Ref } from 'vue'
import Selecto from 'selecto'
import { useHistoryStore } from '../stores/history'
import { useEventListener } from './useEventListener'

export function useHistorySelection(container: Ref<HTMLElement | null>) {
  const history = useHistoryStore()
  useEventListener(document, 'click', (event) => {
    if (
      (event.target as Element).closest?.(
        '.history-item, .generation-task-card, .history-selection-bar, .history-heading',
      )
    )
      return
    if (history.selected.size) history.selected = new Set()
  })
  let selecto: Selecto | null = null
  let selectionBeforeDrag = new Set<string>()
  let dragging = false
  const mobile = window.matchMedia(
    '(max-width: 780px), (hover: none) and (pointer: coarse)',
  )
  function toggled(elements: Element[]) {
    const next = new Set(selectionBeforeDrag)
    elements.forEach((element) => {
      const key = (element as HTMLElement).dataset.historyKey
      if (!key) return
      if (next.has(key)) next.delete(key)
      else next.add(key)
    })
    return next
  }
  async function syncSelection() {
    await nextTick()
    if (!selecto || !container.value || dragging) return
    selecto.setSelectedTargets(
      Array.from(container.value.children).filter((element) =>
        history.selected.has((element as HTMLElement).dataset.historyKey || ''),
      ) as HTMLElement[],
    )
  }
  function bind() {
    selecto?.destroy()
    selecto = null
    dragging = false
    container.value?.classList.remove('is-selecting')
    if (!container.value || mobile.matches) return
    const list = container.value
    selecto = new Selecto({
      // Vue owns the list children; keep Selecto's overlay in the stable parent.
      container: list.parentElement!,
      dragContainer: list,
      selectableTargets: [
        () =>
          Array.from(
            list.querySelectorAll<HTMLElement>(
              '.history-item, .generation-task-card.error',
            ),
          ).filter((element) => Boolean(element.dataset.historyKey)),
      ],
      selectByClick: false,
      selectFromInside: true,
      preventDragFromInside: false,
      preventClickEventOnDrag: true,
      keyContainer: window,
      hitRate: 1,
      dragCondition: ({ inputEvent }) =>
        !(inputEvent.target as HTMLElement).closest(
          '.history-actions, .history-select, .favorite-folder-card, input, select',
        ),
      scrollOptions: {
        container: list,
        threshold: 64,
        throttleTime: 16,
        checkScrollEvent: true,
        requestScroll: ({ container, direction }) => {
          container.scrollTop += direction[1] * 12
          container.scrollLeft += direction[0] * 12
        },
      },
    })
    selecto.on('selectStart', () => {
      selectionBeforeDrag = new Set(history.selected)
      dragging = true
      list.classList.add('is-selecting')
    })
    selecto.on('select', ({ selected }) => {
      history.selected = toggled(selected)
    })
    selecto.on('selectEnd', ({ selected }) => {
      history.selected = toggled(selected)
      dragging = false
      list.classList.remove('is-selecting')
      void syncSelection()
    })
    selecto.on('dragEnd', () => {
      dragging = false
      list.classList.remove('is-selecting')
    })
    void syncSelection()
  }
  onMounted(() => {
    bind()
    mobile.addEventListener('change', bind)
  })
  watch(() => [[...history.selected], history.cards], syncSelection, {
    flush: 'post',
  })
  onScopeDispose(() => {
    mobile.removeEventListener('change', bind)
    selecto?.destroy()
  })
}
