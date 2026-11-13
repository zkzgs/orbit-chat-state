<script setup lang="ts">
import type { Message, StoredImage } from '../types/models'
import { renderMarkdown } from '../utils/markdown'
import { formatTime } from '../utils/format'
import { copyText } from '../utils/files'
import { useChatStore } from '../stores/chat'
import { useInterfaceStore } from '../stores/interface'
import { useViewerStore } from '../stores/viewer'
import { useWorkspaceStore } from '../stores/workspace'
const props = defineProps<{
  message: Message
  images: StoredImage[]
  streaming?: boolean
}>()
const chat = useChatStore()
const ui = useInterfaceStore()
const viewer = useViewerStore()
const workspace = useWorkspaceStore()
function previewMarkdownImage(event: MouseEvent) {
  const target = event.target
  if (
    !(target instanceof HTMLImageElement) ||
    !target.classList.contains('markdown-inline-image')
  )
    return
  const content = event.currentTarget as HTMLElement
  const images = Array.from(
    content.querySelectorAll<HTMLImageElement>('.markdown-inline-image'),
  )
  viewer.open(
    images.map((image) => image.src),
    images.indexOf(target),
  )
}
async function copy() {
  await copyText(props.message.content)
  ui.notify('已复制到剪贴板')
}
function openImage(image: StoredImage, index: number) {
  const batch = workspace.batches.find(
    (item) => item.id === image.batchId || item.imageIds.includes(image.id),
  )
  if (batch || image.batchId || image.taskId) {
    const task = workspace.tasks.find(
      (item) => item.id === image.taskId || item.batchId === batch?.id,
    )
    const batchIndex = batch?.imageIds.indexOf(image.id) ?? index
    ui.openDetails(batch, task, Math.max(0, batchIndex), image.id)
    return
  }
  viewer.open(
    props.images.map((item) => item.src),
    index,
  )
}
</script>
<template>
  <article
    class="message"
    :class="[message.role, { streaming }]"
    :data-message-id="message.id"
  >
    <div class="message-avatar">
      {{ message.role === 'assistant' ? 'O' : 'ME' }}
    </div>
    <div class="message-content" @click="previewMarkdownImage">
      <div class="message-meta">
        <span class="message-role">{{
          message.role === 'assistant' ? 'Orbit' : '你'
        }}</span
        ><span class="message-time">{{ formatTime(message.createdAt) }}</span>
      </div>
      <details
        v-if="message.reasoning"
        class="message-reasoning"
        :open="streaming"
      >
        <summary>
          {{
            streaming && !message.content
              ? chat.agentActivity?.status || '正在思考'
              : '思考过程'
          }}
        </summary>
        <div
          class="message-reasoning-content markdown-body"
          v-html="renderMarkdown(message.reasoning)"
        ></div>
      </details>
      <div
        class="message-text markdown-body"
        v-html="renderMarkdown(message.content)"
      ></div>
      <div v-if="message.error" class="message-error" role="alert">
        请求失败: {{ message.error }}
      </div>
      <div v-if="message.files?.length" class="chat-files">
        <div v-for="file in message.files" :key="file.id" class="chat-file">
          <span>PDF</span><span class="chat-file-name">{{ file.name }}</span>
        </div>
      </div>
      <div class="message-images" v-if="images.length">
        <button
          v-for="(image, index) in images"
          :key="image.id"
          class="message-image-button"
          aria-label="预览消息图片"
          @click.stop="openImage(image, index)"
        >
          <img
            class="message-image"
            v-image-source.full="image.src"
            alt=""
            :data-image-id="image.id"
            draggable="false"
            decoding="async"
            loading="lazy"
          />
        </button>
      </div>
      <div class="message-actions">
        <button
          v-if="message.role === 'user'"
          class="message-action"
          @click="chat.editMessage(message)"
        >
          修改</button
        ><button class="message-action" @click="copy">复制</button
        ><button class="message-action" @click="chat.deleteMessage(message.id)">
          删除
        </button>
      </div>
    </div>
  </article>
</template>
