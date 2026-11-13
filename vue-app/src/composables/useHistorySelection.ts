import { onMounted, onScopeDispose, type Ref } from 'vue'
import { createGridSelection } from '../utils/virtual-grid.js'
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
  let dispose: (() => void) | undefined
  onMounted(() => {
    dispose = createGridSelection(container.value!, {
      keys: () =>
        history.isFolderIndex ? [] : history.cards.map((card) => card.key),
      selected: () => history.selected,
      change: (value: Set<string>) => {
        if (
          value.size !== history.selected.size ||
          [...value].some((key) => !history.selected.has(key))
        )
          history.selected = value
      },
    })
  })
  onScopeDispose(() => dispose?.())
}
