<script setup lang="ts">
import { computed } from 'vue'
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
      >
        <button
          class="conversation-item"
          :class="{
            active: conversation.id === workspace.state.activeConversationId,
          }"
          :aria-busy="
            chat.generating && conversation.id === chat.generatingConversationId
          "
          @click="chat.selectConversation(conversation.id)"
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
            @click="chat.renameConversation(conversation.id)"
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
