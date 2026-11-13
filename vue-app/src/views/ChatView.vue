<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { useWorkspaceStore } from '../stores/workspace'
import { useChatStore } from '../stores/chat'
import ChatMessage from '../components/ChatMessage.vue'
const workspace = useWorkspaceStore()
const chat = useChatStore()
const messages = computed(() => workspace.activeConversation?.messages || [])
async function quickPrompt(text: string) {
  chat.draft = text
  await nextTick()
  document.getElementById('messageInput')?.focus()
}
</script>
<template>
  <div class="chat-view" id="chatView">
    <div class="welcome-panel" id="welcomePanel" v-show="!messages.length">
      <div class="welcome-kicker">
        <span class="sparkle">✦</span> Personal AI workspace
      </div>
      <h1>把想法, 变成<br /><em>下一步行动</em></h1>
      <div class="quick-actions">
        <button
          class="quick-action"
          @click="quickPrompt('帮我把下面这段内容整理成一份清晰的行动清单:')"
        >
          <span class="quick-icon">↗</span><span>整理成行动清单</span></button
        ><button
          class="quick-action"
          @click="
            quickPrompt(
              '用产品经理的视角, 帮我分析这个想法的优先级, 风险和下一步:',
            )
          "
        >
          <span class="quick-icon">◒</span><span>分析一个想法</span></button
        ><button
          class="quick-action"
          @click="quickPrompt('请帮我把这段话改得更自然, 简洁, 专业:')"
        >
          <span class="quick-icon">Aa</span><span>润色一段文字</span>
        </button>
      </div>
    </div>
    <div id="messageList" class="message-list" aria-live="polite">
      <ChatMessage
        v-for="message in messages"
        :key="message.id"
        :message="message"
        :images="workspace.messageImages(message.imageIds)"
        :streaming="message.id === chat.streamingId"
      />
    </div>
    <div
      id="typingIndicator"
      class="typing-indicator"
      v-show="
        chat.generating &&
        chat.generatingConversationId ===
          workspace.state.activeConversationId &&
        !chat.streamingId &&
        !chat.agentActivity
      "
    >
      <span></span><span></span><span></span><em>正在思考</em>
    </div>
    <div
      v-if="
        chat.agentActivity &&
        chat.generatingConversationId === workspace.state.activeConversationId
      "
      class="agent-activity"
      role="status"
      aria-live="polite"
    >
      <span class="agent-activity-spinner" aria-hidden="true"></span>
      <span>{{ chat.agentActivity.status }}</span>
      <span
        v-if="chat.agentActivity.prompt"
        class="agent-activity-prompt"
        :title="chat.agentActivity.prompt"
        >{{ chat.agentActivity.prompt }}</span
      >
    </div>
  </div>
</template>
