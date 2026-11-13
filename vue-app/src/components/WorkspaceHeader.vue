<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEventListener } from '../composables/useEventListener'
import { useChatStore } from '../stores/chat'
import { useSettingsStore } from '../stores/settings'
import { useWorkspaceStore } from '../stores/workspace'
import { useInterfaceStore } from '../stores/interface'
const workspace = useWorkspaceStore()
const ui = useInterfaceStore()
const chat = useChatStore()
const settings = useSettingsStore()
const mobileQuery = matchMedia('(max-width: 780px)')
const mobile = ref(mobileQuery.matches)
useEventListener(mobileQuery, 'change', (event) => {
  mobile.value = (event as MediaQueryListEvent).matches
})
const sidebarExpanded = computed(() =>
  mobile.value ? ui.sidebarOpen : !ui.sidebarCollapsed,
)
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
    <button
      class="icon-button sidebar-toggle"
      id="openSidebar"
      :hidden="ui.activeView === 'image'"
      :aria-label="sidebarExpanded ? '收起侧栏' : '展开侧栏'"
      :aria-expanded="sidebarExpanded"
      aria-controls="sidebar"
      @click="ui.toggleSidebar"
    >
      ☰
    </button>
    <div class="topbar-brand">
      <div class="brand-mark">O</div>
      <div>
        <div class="brand-name">Orbit Chat</div>
        <div class="brand-caption">个人 AI 工作台</div>
      </div>
    </div>
    <div class="mobile-brand-row">
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
