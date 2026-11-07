import { computed, onMounted, onScopeDispose, watch } from 'vue'
import { useWorkspaceStore } from '../stores/workspace'
import { useInterfaceStore } from '../stores/interface'
import { useChatStore } from '../stores/chat'
import { useImageGenerationStore } from '../stores/image-generation'
import { usePromptTemplatesStore } from '../stores/prompt-templates'
import { useSettingsStore } from '../stores/settings'
import { useEventListener } from './useEventListener'
import { disposeImageWorker } from '../workers/client'

export function useWorkspace() {
  const workspace = useWorkspaceStore()
  const ui = useInterfaceStore()
  const chat = useChatStore()
  const image = useImageGenerationStore()
  const templates = usePromptTemplatesStore()
  const settings = useSettingsStore()
  watch(
    () =>
      workspace.state.settings.imagePrivacyEnabled
        ? workspace.state.settings.imagePrivacyMode
        : '',
    (mode) => {
      document.documentElement.dataset.imagePrivacy = mode
    },
    { immediate: true },
  )
  const modalOpen = computed(
    () =>
      ui.settingsOpen ||
      ui.sizeOpen ||
      ui.polishOpen ||
      ui.details.open ||
      ui.audit.open ||
      ui.favorite.open ||
      ui.favoriteDelete.open ||
      ui.viewer.open ||
      ui.dataScope.open,
  )
  function syncModalViewport() {
    if (!modalOpen.value) return
    const viewport = window.visualViewport
    if (viewport && viewport.scale !== 1) return
    const height = Math.min(
      window.innerHeight,
      viewport?.height || window.innerHeight,
    )
    const style = document.documentElement.style
    const viewportHeight = `${height}px`
    const viewportTop = `${viewport?.offsetTop || 0}px`
    if (style.getPropertyValue('--modal-viewport-height') !== viewportHeight)
      style.setProperty('--modal-viewport-height', viewportHeight)
    if (style.getPropertyValue('--modal-viewport-top') !== viewportTop)
      style.setProperty('--modal-viewport-top', viewportTop)
  }
  watch(modalOpen, syncModalViewport, { flush: 'post' })
  watch(
    () => ui.activeView,
    (view) => {
      ui.sidebarOpen = false
      if (view === 'image') chat.resetDraft()
    },
  )
  useEventListener(window, 'keydown', (event) => {
    const target = event.target
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      chat.newConversation()
    }
    if (event.key === 'Escape') ui.closeTopDialog()
    if (
      ui.viewer.open &&
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) &&
      ['ArrowLeft', 'ArrowRight'].includes(event.key)
    ) {
      event.preventDefault()
      const count = ui.viewer.sources.length
      ui.viewer.index =
        (ui.viewer.index + (event.key === 'ArrowLeft' ? -1 : 1) + count) % count
    }
  })
  useEventListener(window, 'pagehide', () => disposeImageWorker())
  useEventListener(window, 'resize', syncModalViewport)
  useEventListener(window.visualViewport, 'resize', syncModalViewport)
  useEventListener(window.visualViewport, 'scroll', syncModalViewport, {
    passive: true,
  })
  onMounted(async () => {
    syncModalViewport()
    try {
      await workspace.initialize()
    } catch {
      /* IndexedDB 禁用时仍可使用页面 */
    }
    templates.selectPrompt(workspace.state.settings.activeImagePromptTemplateId)
    void settings.loadModels('chat', false)
    void settings.loadModels('image', false)
  })
  onScopeDispose(() => {
    chat.dispose()
    image.dispose()
    templates.dispose()
    ui.dispose()
    disposeImageWorker()
  })
  return { workspace, ui }
}
