import { watch } from 'vue'
import { useWorkspaceStore } from '../stores/workspace'
import { useInterfaceStore } from '../stores/interface'
import { useChatStore } from '../stores/chat'
import { useEventListener } from './useEventListener'

// Fragment-only routes work for both hosted builds and file:// single HTMLs.
// Replacing the current entry keeps per-conversation navigation out of history.
export function useHashRoute() {
  const workspace = useWorkspaceStore()
  const ui = useInterfaceStore()
  const chat = useChatStore()
  let applying = false
  function write() {
    if (applying) return
    const hash =
      ui.activeView === 'chat'
        ? '#/chat?' +
          new URLSearchParams({ c: workspace.state.activeConversationId || '' })
        : '#/image'
    if (window.location.hash === hash) return
    try {
      window.history.replaceState(window.history.state, '', hash)
    } catch {
      window.location.replace(hash)
    }
  }
  function read() {
    applying = true
    const [path, query = ''] = window.location.hash.slice(1).split('?')
    if (path === '/chat') {
      const id = new URLSearchParams(query).get('c')
      if (id && workspace.state.conversations.some((item) => item.id === id))
        chat.selectConversation(id)
      else if (
        !workspace.state.conversations.some(
          (item) => item.id === workspace.state.activeConversationId,
        )
      )
        workspace.state.activeConversationId =
          workspace.state.conversations[0]?.id || null
      ui.activeView = 'chat'
    } else ui.activeView = 'image'
    applying = false
    write()
  }
  read()
  watch(
    [() => ui.activeView, () => workspace.state.activeConversationId],
    write,
    { flush: 'post' },
  )
  useEventListener(window, 'hashchange', read)
}
