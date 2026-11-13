<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import { useEventListener } from '../composables/useEventListener'
import {
  bindSidebarResize,
  bindSidebarTitles,
} from '../utils/sidebar-resize.js'
import { useChatStore } from '../stores/chat'
import { useWorkspaceStore } from '../stores/workspace'
import { useInterfaceStore } from '../stores/interface'
const workspace = useWorkspaceStore()
const ui = useInterfaceStore()
const chat = useChatStore()
const conversations = computed(() => {
  const updatedAt = (item: (typeof workspace.state.conversations)[number]) =>
    Math.max(
      item.createdAt,
      item.updatedAt || 0,
      item.messages?.[item.messages.length - 1]?.createdAt || item.createdAt,
    )
  const time =
    workspace.state.settings.conversationSort === 'created'
      ? (item: (typeof workspace.state.conversations)[number]) => item.createdAt
      : updatedAt
  return [...workspace.state.conversations].sort(
    (first, second) => time(second) - time(first),
  )
})
const editingId = ref('')
const editingTitle = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
let ignoreBlur = false
const menuId = ref('')
const menuPosition = ref({ left: '0px', top: '0px' })
const menuConversation = computed(() =>
  conversations.value.find((item) => item.id === menuId.value),
)
const menu = ref<HTMLElement | null>(null)
let disposeResize: (() => void) | undefined
let disposeTitles: (() => void) | undefined
onMounted(() => {
  disposeResize = bindSidebarResize(
    document.getElementById('sidebar'),
    document.getElementById('sidebarResize'),
    () => {
      ui.sidebarCollapsed = true
    },
  )
  disposeTitles = bindSidebarTitles(document.getElementById('conversationList'))
})
onBeforeUnmount(() => {
  disposeResize?.()
  disposeTitles?.()
})
function closeMenu() {
  menuId.value = ''
}
async function openMenu(id: string, event: MouseEvent) {
  if (menuId.value === id) {
    closeMenu()
    return
  }
  menuId.value = id
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  await nextTick()
  menuPosition.value = {
    left: Math.max(8, Math.min(rect.right + 6, window.innerWidth - 180)) + 'px',
    top:
      Math.max(
        8,
        Math.min(
          rect.bottom + 4,
          window.innerHeight - (menu.value?.offsetHeight || 190) - 8,
        ),
      ) + 'px',
  }
}
useEventListener(document, 'click', (event) => {
  if (
    !(event.target as Element).closest(
      '.conversation-row-menu, .conversation-more',
    )
  )
    closeMenu()
})
useEventListener(window, 'resize', closeMenu)
useEventListener(
  document,
  'scroll',
  (event) => {
    if (!(event.target as Element).closest?.('.conversation-row-menu'))
      closeMenu()
  },
  { capture: true },
)
useEventListener(window, 'keydown', (event) => {
  if (event.key === 'Escape') closeMenu()
})

function setTitleInput(el: unknown) {
  titleInput.value = el instanceof HTMLInputElement ? el : null
}

async function startRename(id: string, currentTitle: string) {
  editingId.value = id
  editingTitle.value = currentTitle
  await nextTick()
  const input = titleInput.value
  if (!input) return
  input.focus()
  input.select()
}

function cancelRename() {
  ignoreBlur = true
  editingId.value = ''
  editingTitle.value = ''
  void nextTick(() => {
    ignoreBlur = false
  })
}

function commitRename() {
  if (!editingId.value) return
  if (ignoreBlur) return
  const id = editingId.value
  const title = editingTitle.value
  editingId.value = ''
  editingTitle.value = ''
  chat.renameConversation(id, title)
}

function toggleSelectionMode() {
  cancelRename()
  chat.toggleConversationSelection()
}

function onRenameKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    commitRename()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}
</script>

<template>
  <aside
    :class="{ open: ui.sidebarOpen }"
    class="sidebar"
    id="sidebar"
    aria-label="会话侧栏"
  >
    <div
      id="sidebarResize"
      class="sidebar-resize"
      role="separator"
      aria-label="调整对话侧栏宽度"
      aria-orientation="vertical"
      aria-valuemin="160"
      aria-valuemax="520"
      aria-valuenow="274"
      tabindex="0"
    ></div>
    <button
      class="icon-button mobile-only"
      id="closeSidebar"
      aria-label="关闭侧栏"
      @click="ui.sidebarOpen = false"
    >
      ×
    </button>
    <button
      class="new-chat-button"
      id="newChatButton"
      @click="chat.newConversation()"
    >
      <span class="button-glyph">＋</span> 新建对话
      <span class="shortcut-hint">⌘ K</span>
    </button>

    <div class="sidebar-section-heading">
      <div class="conversation-heading-label">
        <span>最近对话</span
        ><span class="conversation-count" id="conversationCount">{{
          workspace.state.conversations.length
        }}</span>
      </div>
      <div class="conversation-header-actions">
        <button
          id="toggleConversationSelection"
          class="conversation-multi-toggle"
          type="button"
          :aria-pressed="chat.conversationSelectionMode"
          data-tooltip="批量选择对话"
          @click="toggleSelectionMode"
        >
          {{ chat.conversationSelectionMode ? '退出多选' : '多选' }}
        </button>
      </div>
    </div>
    <div
      v-if="chat.conversationSelectionMode"
      class="conversation-selection-bar"
      id="conversationSelectionBar"
      aria-label="对话批量操作"
    >
      <span id="conversationSelectionCount"
        >{{ chat.selectedConversations.size }} 项</span
      >
      <button id="conversationSelectAll" @click="chat.toggleAllConversations">
        {{ chat.allConversationsSelected ? '取消全选' : '全选' }}
      </button>
      <button
        id="conversationDeleteSelected"
        class="danger-action"
        :disabled="!chat.selectedConversations.size"
        @click="chat.deleteSelectedConversations"
      >
        删除
      </button>
      <button
        id="conversationSelectionDone"
        @click="chat.exitConversationSelection"
      >
        完成
      </button>
    </div>
    <div class="conversation-list" id="conversationList">
      <div
        v-for="conversation in conversations"
        :key="conversation.id"
        class="conversation-row"
        :class="{ editing: editingId === conversation.id }"
      >
        <label
          v-if="chat.conversationSelectionMode"
          class="conversation-item conversation-select-item"
          :class="{
            active: conversation.id === workspace.state.activeConversationId,
          }"
        >
          <input
            type="checkbox"
            :checked="chat.selectedConversations.has(conversation.id)"
            :disabled="chat.isGenerating(conversation.id)"
            @change="chat.toggleSelectedConversation(conversation.id)"
          />
          <span class="conversation-title">{{ conversation.title }}</span>
        </label>
        <template v-else-if="editingId === conversation.id">
          <input
            :ref="setTitleInput"
            class="conversation-title-input"
            :value="editingTitle"
            aria-label="编辑对话标题"
            @input="editingTitle = ($event.target as HTMLInputElement).value"
            @keydown="onRenameKeydown"
            @blur="commitRename"
          />
        </template>
        <template v-else>
          <button
            class="conversation-item"
            :class="{
              active: conversation.id === workspace.state.activeConversationId,
            }"
            :aria-busy="chat.isGenerating(conversation.id)"
            @click="chat.selectConversation(conversation.id)"
            @dblclick.stop="startRename(conversation.id, conversation.title)"
          >
            <span
              class="conversation-icon"
              :class="{
                'is-generating': chat.isGenerating(conversation.id),
              }"
              >{{
                chat.isGenerating(conversation.id)
                  ? ''
                  : conversation.id === workspace.state.activeConversationId
                    ? '●'
                    : '○'
              }}</span
            >
            <span class="conversation-title">{{ conversation.title }}</span>
          </button>
          <div class="conversation-actions">
            <button
              class="conversation-action conversation-more"
              aria-label="对话操作"
              aria-haspopup="menu"
              :aria-expanded="menuId === conversation.id"
              @click.stop="openMenu(conversation.id, $event)"
            >
              ⋯
            </button>
          </div>
        </template>
      </div>
    </div>
  </aside>
  <Teleport to="body">
    <div
      v-if="menuConversation"
      ref="menu"
      class="conversation-row-menu"
      :style="menuPosition"
      role="menu"
      @click="closeMenu"
    >
      <button
        class="rename-conversation"
        role="menuitem"
        @click="startRename(menuConversation.id, menuConversation.title)"
      >
        重命名对话
      </button>
      <button
        class="duplicate-conversation"
        role="menuitem"
        :disabled="chat.isGenerating(menuId)"
        @click="chat.duplicateConversation(menuConversation.id)"
      >
        复制对话
      </button>
      <button
        role="menuitem"
        :disabled="!menuConversation.messages.length || ui.exporting"
        @click="chat.exportConversation('markdown', menuConversation.id)"
      >
        导出 Markdown
      </button>
      <button
        role="menuitem"
        :disabled="!menuConversation.messages.length || ui.exporting"
        @click="chat.exportConversation('html', menuConversation.id)"
      >
        导出 HTML
      </button>
      <button
        class="delete-conversation danger-action"
        role="menuitem"
        @click="chat.deleteConversation(menuConversation.id)"
      >
        删除对话
      </button>
    </div>
  </Teleport>
</template>
