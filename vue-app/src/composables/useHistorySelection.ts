import { onMounted, onScopeDispose, watch, nextTick, type Ref } from 'vue'
import Selecto from 'selecto'
import { useHistoryStore } from '../stores/history'

export function useHistorySelection(container: Ref<HTMLElement | null>) {
  const history = useHistoryStore()
  let selecto: Selecto | null = null
  function elementKeys(elements: Element[]) {
    return elements.flatMap((element) => {
      const key = (element as HTMLElement).dataset.historyKey
      return key ? [key] : []
    })
  }
  async function syncSelection() {
    await nextTick()
    if (!selecto || !container.value) return
    selecto.setSelectedTargets(
      Array.from(container.value.children).filter((element) =>
        history.selected.has((element as HTMLElement).dataset.historyKey || ''),
      ) as HTMLElement[],
    )
  }
  onMounted(() => {
    if (!container.value) return
    selecto = new Selecto({
      container: container.value,
      dragContainer: container.value,
      selectableTargets: ['.history-item', '.generation-task-card'],
      selectByClick: false,
      selectFromInside: false,
      hitRate: 0,
      toggleContinueSelect: 'shift',
      dragCondition: (event) =>
        !(event.inputEvent.target as HTMLElement).closest(
          '.history-actions, .history-select, button, input, select',
        ),
    })
    selecto.on('select', (event) => {
      history.selected = new Set(elementKeys(event.selected))
    })
    void syncSelection()
  })
  watch(() => history.selected, syncSelection, {
    flush: 'post',
  })
  onScopeDispose(() => selecto?.destroy())
}
