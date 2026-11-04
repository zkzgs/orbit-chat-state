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
const connection = computed(() => {
  const state = workspace.state.settings
  if (chat.generating) return 'loading'
  return state.chatApiKey && state.chatBaseUrl ? 'connected' : 'demo'
})
const connectionText = computed(
  () =>
    ({ loading: '请求中', connected: '已连接', demo: '演示模式' })[
      connection.value
    ],
)
const activeTitle = computed(
  () => workspace.activeConversation?.title || '新对话',
)
</script>

<template>
  <header class="topbar">
    <div class="topbar-brand">
      <div class="brand-mark">O</div>
      <div>
        <div class="brand-name">Orbit Chat</div>
        <div class="brand-caption">个人 AI 工作台</div>
      </div>
    </div>
    <div class="mobile-brand-row">
      <button
        class="icon-button"
        id="openSidebar"
        :hidden="ui.activeView === 'image'"
        title="打开侧栏"
        aria-label="打开侧栏"
        @click="ui.sidebarOpen = !ui.sidebarOpen"
      >
        ☰
      </button>
      <div class="mobile-title">Orbit Chat</div>
    </div>
    <div class="mode-switcher" role="tablist" aria-label="工作模式">
      <button
        :class="['mode-tab', { active: ui.activeView === 'image' }]"
        data-view="image"
        role="tab"
        :aria-selected="ui.activeView === 'image'"
        @click="ui.activeView = 'image'"
      >
        <span>生图</span><small>Image</small>
      </button>
      <button
        :class="['mode-tab', { active: ui.activeView === 'chat' }]"
        data-view="chat"
        role="tab"
        :aria-selected="ui.activeView === 'chat'"
        @click="ui.activeView = 'chat'"
      >
        <span>对话</span><small>Chat</small>
      </button>
    </div>
    <div class="topbar-context">
      <div class="eyebrow">当前工作区</div>
      <div class="workspace-title" id="workspaceTitle">
        {{ ui.activeView === 'image' ? '生图工作区' : activeTitle }}
      </div>
    </div>
    <div class="topbar-actions">
      <div class="connection-pill" id="connectionPill" :class="connection">
        <span class="connection-dot"></span
        ><span id="connectionText">{{ connectionText }}</span>
      </div>
      <button
        class="avatar-button"
        id="topbarSettings"
        title="打开设置"
        aria-label="打开设置"
        @click="settings.open()"
      >
        ME
      </button>
    </div>
  </header>
</template>
