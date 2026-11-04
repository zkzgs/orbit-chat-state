<script setup lang="ts">
import { ref } from 'vue'
import { useChatScroll } from './composables/useChatScroll'
import { useWorkspace } from './composables/useWorkspace'
import WorkspaceHeader from './components/WorkspaceHeader.vue'
import ConversationSidebar from './components/ConversationSidebar.vue'
import ChatView from './views/ChatView.vue'
import ImageWorkspace from './views/ImageWorkspace.vue'
import ChatComposer from './components/ChatComposer.vue'
import ImageDetails from './components/ImageDetails.vue'
import TaskAudit from './components/TaskAudit.vue'
import FavoriteFolders from './components/FavoriteFolders.vue'
import FavoriteDelete from './components/FavoriteDelete.vue'
import ImageViewer from './components/ImageViewer.vue'
import PromptPolish from './components/PromptPolish.vue'
import ImageSize from './components/ImageSize.vue'
import WorkspaceSettings from './components/WorkspaceSettings.vue'
import DataScope from './components/DataScope.vue'
import WorkspaceToast from './components/WorkspaceToast.vue'
import { useEventListener } from './composables/useEventListener'

const { ui, workspace } = useWorkspace()
const stage = ref<HTMLElement | null>(null)
useEventListener(document, 'click', (event) => {
  const target = event.target
  if (!(target instanceof Element)) return
  if (
    ui.sidebarOpen &&
    !target.closest('#sidebar') &&
    target.id !== 'openSidebar'
  )
    ui.sidebarOpen = false
  if (ui.exportMenuOpen && !target.closest('.conversation-export-menu'))
    ui.exportMenuOpen = false
})
useChatScroll(
  stage,
  () => workspace.activeConversation.messages,
  () => workspace.state.activeConversationId,
  () => ui.activeView === 'chat',
)
</script>

<template>
  <WorkspaceHeader />
  <div class="app-shell" :class="{ 'image-mode': ui.activeView === 'image' }">
    <ConversationSidebar />
    <main class="main-panel">
      <section ref="stage" class="content-stage">
        <ChatView v-show="ui.activeView === 'chat'" /><ImageWorkspace
          v-show="ui.activeView === 'image'"
        />
      </section>
      <ChatComposer v-show="ui.activeView === 'chat'" />
    </main>
  </div>
  <ImageDetails />
  <TaskAudit />
  <FavoriteFolders />
  <FavoriteDelete />
  <ImageViewer />
  <PromptPolish />
  <ImageSize />
  <WorkspaceSettings />
  <DataScope />
  <WorkspaceToast />
</template>
