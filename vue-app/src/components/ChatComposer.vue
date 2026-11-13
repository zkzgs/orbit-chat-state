<script setup lang="ts">
import PromptEditor from './PromptEditor.vue'
import { chatFileAccept } from '../api/chat-files.js'
import { onMounted, onUnmounted, ref } from 'vue'
import { useChatStore } from '../stores/chat'
import { useSettingsStore } from '../stores/settings'
import { inputFiles, pastedImages } from '../utils/events'
import { useWorkspaceStore } from '../stores/workspace'
import { useInterfaceStore } from '../stores/interface'
import CustomSelect from './CustomSelect.vue'
import ModelInput from './ModelInput.vue'
import AgentImageSettings from './AgentImageSettings.vue'
const workspace = useWorkspaceStore()
const ui = useInterfaceStore()
const chat = useChatStore()
const settings = useSettingsStore()
const dropping = ref(false)
let dragDepth = 0
function keydown(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    if (!chat.generating) void chat.send()
  }
}
function paste(event: ClipboardEvent) {
  const files = pastedImages(event)
  if (files.length) {
    event.preventDefault()
    void chat.addImages(files)
  }
}
function hasFiles(event: DragEvent) {
  return event.dataTransfer?.types.includes('Files')
}
function dragEnter(event: DragEvent) {
  if (!hasFiles(event)) return
  event.preventDefault()
  dragDepth += 1
  dropping.value = true
}
function dragOver(event: DragEvent) {
  if (!hasFiles(event)) return
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'copy'
}
function dragLeave(event: DragEvent) {
  if (!hasFiles(event)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dropping.value = false
}
function drop(event: DragEvent) {
  const containsFiles = hasFiles(event)
  dragDepth = 0
  dropping.value = false
  if (!containsFiles) return
  event.preventDefault()
  const files = Array.from(event.dataTransfer!.files).filter((file) =>
    file.type.startsWith('image/'),
  )
  if (files.length) void chat.addImages(files)
}
const toolbar = ref<HTMLElement | null>(null)
const extras = ref<HTMLElement | null>(null)
const quickSettings = ref<HTMLElement | null>(null)
const compact = ref(false)
const tight = ref(false)
const moreOpen = ref(false)
let extrasWidth = 0
let agentGroupWidth = 0
let lastBarWidth = 0
let observer: ResizeObserver | undefined
function closeMore(event?: Event) {
  if (
    event instanceof KeyboardEvent &&
    event.key === 'Escape'
  ) {
    if (moreOpen.value) {
      event.preventDefault()
      moreOpen.value = false
    }
    return
  }
  if (!event || !(event.target instanceof Node) || !toolbar.value?.contains(event.target))
    moreOpen.value = false
}
function layoutToolbar() {
  const bar = toolbar.value
  const extra = extras.value
  const quick = quickSettings.value
  if (!bar || !extra || !quick || !bar.clientWidth) return
  if (lastBarWidth && lastBarWidth !== bar.clientWidth) moreOpen.value = false
  lastBarWidth = bar.clientWidth
  const contentWidth = (el: HTMLElement) =>
    Math.max(
      el.scrollWidth,
      [...el.children].reduce((sum, child) => sum + (child as HTMLElement).offsetWidth, 0),
    )
  if (!compact.value && extra.offsetWidth) extrasWidth = contentWidth(extra)
  bar.classList.add('toolbar-measuring')
  const group = document.querySelector('.toolbar-agent-group') as HTMLElement | null
  if (group?.offsetWidth) agentGroupWidth = group.offsetWidth
  const model = quick.querySelector('#chatModelQuick')?.closest('label') as HTMLElement | null
  const thinking = quick.querySelector('#reasoningEffortQuick')?.closest('label') as HTMLElement | null
  const modelW = model?.offsetWidth || 0
  const thinkingW = thinking?.offsetWidth || 0
  const gap = 16
  const preferredQuick = (agentGroupWidth || 0) + modelW + thinkingW + gap
  bar.classList.remove('toolbar-measuring')
  if (!extrasWidth) return
  compact.value = extrasWidth + preferredQuick + 16 > bar.clientWidth
  if (!compact.value) {
    tight.value = false
    moreOpen.value = false
    return
  }
  const moreW = bar.querySelector('#toolbarMoreButton') instanceof HTMLElement
    ? Math.max(52, (bar.querySelector('#toolbarMoreButton') as HTMLElement).offsetWidth)
    : 52
  tight.value = moreW + preferredQuick + 12 > bar.clientWidth
}
onMounted(() => {
  layoutToolbar()
  observer = new ResizeObserver(() => layoutToolbar())
  if (toolbar.value) observer.observe(toolbar.value)
  document.addEventListener('click', closeMore)
  document.addEventListener('keydown', closeMore)
})
onUnmounted(() => {
  observer?.disconnect()
  document.removeEventListener('click', closeMore)
  document.removeEventListener('keydown', closeMore)
})
</script>

<template>
  <footer class="composer-wrap" id="composerWrap">
    <div
      class="context-toolbar"
      :class="{ 'toolbar-is-compact': compact, 'toolbar-is-tight': tight }"
      ref="toolbar"
    >
      <div
        class="context-mode toolbar-inline-extras"
        role="group"
        aria-label="上下文策略"
        ref="extras"
        v-show="!compact"
      >
        <span class="toolbar-label">上下文</span>
        <button
          class="context-option"
          :class="{ active: workspace.state.contextMode === 'client' }"
          @click="workspace.state.contextMode = 'client'"
          data-context="client"
          title="每次请求都带上本会话的历史消息"
        >
          客户端拼接
        </button>
        <button
          class="context-option"
          :class="{ active: workspace.state.contextMode === 'single' }"
          @click="workspace.state.contextMode = 'single'"
          data-context="single"
          title="每次只发送当前问题和系统提示词"
        >
          单轮请求
        </button>
        <label
          class="search-toggle"
          title="向对话接口发送 web_search_options；是否真正联网由接口和模型决定"
          ><input
            v-model="workspace.state.settings.chatWebSearch"
            type="checkbox"
            id="chatWebSearch"
          /><span>联网搜索</span></label
        >
        <label
          class="search-toggle"
          title="开启后边生成边显示回复；关闭则等完整回复后一次显示"
          ><input
            v-model="workspace.state.settings.chatStream"
            type="checkbox"
            id="chatStream"
          /><span>流式输出</span></label
        >
      </div>
      <div
        class="chat-quick-settings"
        aria-label="当前对话模型设置"
        ref="quickSettings"
      >
        <Teleport defer to="#toolbarMoreExtra" :disabled="!tight">
          <div class="toolbar-agent-group">
            <label
              class="search-toggle toolbar-bar-agent"
              title="允许对话模型按需调用独立生图接口"
              ><input
                id="chatImageTools"
                type="checkbox"
                v-model="workspace.state.settings.chatImageTools"
              /><span>Agent 生图</span></label
            >
            <AgentImageSettings />
          </div>
        </Teleport>
        <label class="quick-setting"
          ><span>模型</span
          ><ModelInput
            v-model="workspace.state.settings.chatModel"
            id="chatModelQuick"
            label="当前对话模型"
            :models="workspace.modelCatalog.chat"
            refresh
            :refreshing="settings.loadingModels.chat"
            @refresh="settings.loadModels('chat', false)"
        /></label>
        <label class="quick-setting toolbar-bar-reasoning"
          ><span>思考</span
          ><CustomSelect
            v-model="workspace.state.settings.reasoningEffort"
            id="reasoningEffortQuick"
            aria-label="当前对话思考程度"
            :options="[
              { value: 'auto', label: '自动' },
              { value: 'none', label: '关闭' },
              { value: 'minimal', label: '最小' },
              { value: 'low', label: '轻度' },
              { value: 'medium', label: '中' },
              { value: 'high', label: '高' },
              { value: 'xhigh', label: '极高' },
              { value: 'max', label: 'Ultra' },
            ]"
        /></label>
      </div>
      <div class="toolbar-more-host" v-show="compact">
        <button
          type="button"
          class="toolbar-more-button"
          id="toolbarMoreButton"
          aria-haspopup="true"
          :aria-expanded="moreOpen"
          @click.stop="moreOpen = !moreOpen"
        >
          更多
        </button>
        <div class="toolbar-more-menu" id="toolbarMoreMenu" :hidden="!moreOpen">
          <div class="context-mode" role="group" aria-label="上下文策略">
            <span class="toolbar-label">上下文</span>
            <button
              class="context-option"
              :class="{ active: workspace.state.contextMode === 'client' }"
              @click="workspace.state.contextMode = 'client'"
              data-context="client"
              title="每次请求都带上本会话的历史消息"
            >
              客户端拼接
            </button>
            <button
              class="context-option"
              :class="{ active: workspace.state.contextMode === 'single' }"
              @click="workspace.state.contextMode = 'single'"
              data-context="single"
              title="每次只发送当前问题和系统提示词"
            >
              单轮请求
            </button>
            <label
              class="search-toggle"
              title="向对话接口发送 web_search_options；是否真正联网由接口和模型决定"
              ><input
                v-model="workspace.state.settings.chatWebSearch"
                type="checkbox"
              /><span>联网搜索</span></label
            >
            <label
              class="search-toggle"
              title="开启后边生成边显示回复；关闭则等完整回复后一次显示"
              ><input
                v-model="workspace.state.settings.chatStream"
                type="checkbox"
              /><span>流式输出</span></label
            >
          </div>
          <div class="toolbar-more-extra" id="toolbarMoreExtra" :hidden="!tight"></div>
        </div>
      </div>
    </div>
    <div
      class="composer-box"
      id="composerBox"
      :class="{ 'image-drop-active': dropping }"
      @dragenter="dragEnter"
      @dragover="dragOver"
      @dragleave="dragLeave"
      @drop.capture="drop"
    >
      <div :hidden="!chat.editingId" class="editing-banner" id="editingBanner">
        <span>正在修改一条消息</span
        ><button type="button" id="cancelEdit" @click="chat.resetDraft()">
          取消修改
        </button>
      </div>
      <div
        id="attachmentPreview"
        class="attachment-preview"
        :hidden="!chat.attachments.length"
      >
        <div
          v-for="(image, index) in chat.attachments"
          :key="image.id"
          class="attachment-item"
        >
          <img
            v-image-source.full="image.data"
            alt="待发送的图片"
            @click="
              ui.openViewer(
                chat.attachments.map((item) => item.data),
                index,
              )
            "
          /><button
            type="button"
            class="remove-attachment"
            aria-label="移除图片"
            @click="chat.attachments.splice(index, 1)"
          >
            ×
          </button>
        </div>
      </div>
      <div
        v-if="chat.files.length"
        class="chat-files"
        id="fileAttachmentPreview"
      >
        <div
          v-for="(file, index) in chat.files"
          :key="file.id"
          class="chat-file"
        >
          <span>PDF</span><span class="chat-file-name">{{ file.name }}</span>
          <button
            type="button"
            aria-label="移除文件"
            @click="chat.files.splice(index, 1)"
          >
            ×
          </button>
        </div>
      </div>
      <PromptEditor
        class="chat-composer-prompt"
        v-model="chat.draft"
        :images="chat.mentionImages"
        id="messageInput"
        :rows="1"
        placeholder="给 Orbit Chat 发消息..."
        aria-label="消息输入框"
        :auto-resize="true"
        @paste="paste($event)"
        @keydown="keydown($event)"
        @drop="chat.addImages($event)"
      />
      <div class="composer-actions">
        <div class="composer-left-actions">
          <label
            class="icon-button composer-icon"
            title="上传图片"
            aria-label="上传图片"
            ><span>⊕</span
            ><input
              type="file"
              id="imageUpload"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              @change="chat.addImages(inputFiles($event))"
          /></label>
          <label
            class="icon-button composer-icon file-upload-button"
            title="上传文件"
            aria-label="上传文件"
            ><span>▤</span
            ><input
              type="file"
              id="fileUpload"
              :accept="chatFileAccept"
              multiple
              hidden
              @change="chat.addTextFiles(inputFiles($event))"
          /></label>
          <span class="composer-hint">Enter 发送 · Shift + Enter 换行</span>
        </div>
        <button
          class="send-button"
          :class="{ 'is-stop': chat.generating }"
          id="sendButton"
          :title="chat.generating ? '暂停生成' : '发送消息'"
          :aria-label="chat.generating ? '暂停生成' : '发送消息'"
          :data-mode="chat.generating ? 'stop' : 'send'"
          @click="chat.send()"
        >
          <span>{{ chat.generating ? '■' : '↑' }}</span>
        </button>
      </div>
    </div>
    <div
      class="composer-footnote"
      aria-label="AI 可能会犯错, 请核对重要信息 · 配置你的接口"
    >
      <span class="composer-footnote-copy">AI 可能会犯错, 请核对重要信息</span
      ><span class="composer-footnote-separator">·</span
      ><button
        id="openSettingsFromFootnote"
        v-text="'配置你的接口'"
        @click="settings.open()"
      ></button>
    </div>
  </footer>
</template>
