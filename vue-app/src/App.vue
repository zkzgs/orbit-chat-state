<script setup lang="ts">
import { ref } from 'vue'
import { useTooltips } from './composables/useTooltips'
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
import ImageContextMenu from './components/ImageContextMenu.vue'
import { useEventListener } from './composables/useEventListener'

const { ui, workspace } = useWorkspace()
useTooltips()
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
})
const { follow, stickToBottom } = useChatScroll(
  stage,
  () => workspace.activeConversation.messages,
  () => workspace.state.activeConversationId,
  () => ui.activeView === 'chat',
)
</script>

<template>
  <WorkspaceHeader />
  <div
    class="app-shell"
    :class="{
      'image-mode': ui.activeView === 'image',
      'sidebar-collapsed': ui.sidebarCollapsed,
    }"
  >
    <ConversationSidebar />
    <main class="main-panel">
      <section ref="stage" class="content-stage">
        <ChatView v-show="ui.activeView === 'chat'" /><ImageWorkspace
          v-show="ui.activeView === 'image'"
        />
      </section>
      <div class="chat-scroll-anchor" v-show="ui.activeView === 'chat'">
        <button
          v-show="!follow"
          id="scrollChatBottom"
          class="chat-scroll-bottom"
          type="button"
          aria-label="回到底部"
          @click="stickToBottom"
        >
          ↓
        </button>
      </div>
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
  <ImageContextMenu />
  <div class="data-transfer-progress">
    <div
      v-if="ui.importProgress.active"
      id="importProgress"
      class="import-progress transfer-progress-panel"
      :class="{ indeterminate: ui.importProgress.indeterminate }"
      role="status"
      aria-live="polite"
    >
      <div class="import-progress-label">
        <span>{{ ui.importProgress.label }}</span>
        <span>{{ ui.importProgress.percent }}%</span>
      </div>
      <div
        class="import-progress-track"
        role="progressbar"
        aria-label="导入进度"
        :aria-valuenow="
          ui.importProgress.indeterminate
            ? undefined
            : ui.importProgress.percent
        "
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span :style="{ width: ui.importProgress.percent + '%' }"></span>
      </div>
    </div>
    <div
      v-if="ui.exportProgress.active"
      id="exportProgress"
      class="import-progress transfer-progress-panel"
      role="status"
      aria-live="polite"
    >
      <div class="import-progress-label">
        <span>{{ ui.exportProgress.label }}</span>
        <span>{{ ui.exportProgress.percent }}%</span>
      </div>
      <div
        class="import-progress-track"
        role="progressbar"
        aria-label="导出进度"
        :aria-valuenow="ui.exportProgress.percent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span :style="{ width: ui.exportProgress.percent + '%' }"></span>
      </div>
    </div>
  </div>
</template>
