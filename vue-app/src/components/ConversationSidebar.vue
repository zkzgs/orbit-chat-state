<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useChatStore } from '../stores/chat'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'
import { useInterfaceStore } from '../stores/interface'
const workspace = useWorkspaceStore()
const ui = useInterfaceStore()
const chat = useChatStore()
const settings = useSettingsStore()
const conversations = computed(() =>
  [...workspace.state.conversations].sort((a, b) => b.createdAt - a.createdAt),
)
const editingId = ref('')
const editingTitle = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
let ignoreBlur = false

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
    <button
      class="icon-button mobile-only"
      id="closeSidebar"
      title="关闭侧栏"
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
      <span>最近对话</span>
      <span class="conversation-count" id="conversationCount">{{
        workspace.state.conversations.length
      }}</span>
    </div>
    <div class="conversation-list" id="conversationList">
      <div
        v-for="conversation in conversations"
        :key="conversation.id"
        class="conversation-row"
        :class="{ editing: editingId === conversation.id }"
      >
        <template v-if="editingId === conversation.id">
          <input
            :ref="setTitleInput"
            class="conversation-title-input"
            :value="editingTitle"
            aria-label="编辑对话标题"
            @input="
              editingTitle = ($event.target as HTMLInputElement).value
            "
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
            :aria-busy="
              chat.generating &&
              conversation.id === chat.generatingConversationId
            "
            @click="chat.selectConversation(conversation.id)"
            @dblclick.stop="
              startRename(conversation.id, conversation.title)
            "
          >
            <span
              class="conversation-icon"
              :class="{
                'is-generating':
                  chat.generating &&
                  conversation.id === chat.generatingConversationId,
              }"
              >{{
                chat.generating &&
                conversation.id === chat.generatingConversationId
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
              class="conversation-action"
              title="重命名对话"
              aria-label="重命名对话"
              @click.stop="startRename(conversation.id, conversation.title)"
            >
              ✎</button
            ><button
              class="conversation-action"
              title="删除对话"
              aria-label="删除对话"
              @click="chat.deleteConversation(conversation.id)"
            >
              ×
            </button>
          </div>
        </template>
      </div>
    </div>

    <div class="sidebar-footer">
      <div class="privacy-note">
        <span class="status-dot"></span><span>数据仅保存在本机</span>
      </div>
      <button class="settings-link" id="openSettings" @click="settings.open()">
        <span class="settings-symbol">⚙</span> 接口与偏好设置
      </button>
    </div>
  </aside>
</template>
